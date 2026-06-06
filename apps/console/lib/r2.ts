import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// One adapter today: the S3-compatible object store that holds attachment
// bytes. R2 in prod, MinIO via docker-compose locally. Endpoint + creds +
// bucket are env-driven so this single module is the only place that knows
// the S3 dialect — see `server/attachments.ts` (Console) and
// `apps/agent/src/r2-fetcher.ts` (Agent) for the two callers.

const endpoint = process.env.R2_ENDPOINT ?? 'http://127.0.0.1:9000';
const accessKeyId = process.env.R2_ACCESS_KEY_ID ?? 'tempo-local';
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY ?? 'tempo-local-secret';
const region = process.env.R2_REGION ?? 'auto';
const bucket = process.env.R2_BUCKET ?? 'tempo-attachments';

const client = new S3Client({
  endpoint,
  region,
  credentials: { accessKeyId, secretAccessKey },
  // MinIO + most S3-compats only accept path-style addressing without DNS
  // wildcard certs; R2 also accepts it. One toggle covers both.
  forcePathStyle: true,
});

export function objectKey(threadId: string, attachmentId: string): string {
  return `${threadId}/${attachmentId}`;
}

export async function signPutUrl(
  key: string,
  mime: string,
  byte_len: number,
  ttlSeconds: number,
): Promise<string> {
  const cmd = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: mime,
    ContentLength: byte_len,
  });
  return getSignedUrl(client, cmd, { expiresIn: ttlSeconds });
}

export async function signGetUrl(key: string, ttlSeconds: number): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(client, cmd, { expiresIn: ttlSeconds });
}

export async function headObject(key: string): Promise<{ byte_len: number; mime: string } | null> {
  try {
    const res = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return {
      byte_len: res.ContentLength ?? 0,
      mime: res.ContentType ?? 'application/octet-stream',
    };
  } catch (e) {
    const name = (e as { name?: string }).name;
    if (name === 'NotFound' || name === 'NoSuchKey') return null;
    throw e;
  }
}

// Used on thread delete: list every object under `<thread_id>/` and remove
// them in batches of 1000 (the S3 DeleteObjects ceiling). DB cascade still
// runs the row removal; this strips the underlying bytes.
export async function deletePrefix(prefix: string): Promise<void> {
  let token: string | undefined;
  do {
    const list = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix.endsWith('/') ? prefix : `${prefix}/`,
        ContinuationToken: token,
      }),
    );
    const keys = list.Contents?.map((o) => o.Key).filter((k): k is string => Boolean(k)) ?? [];
    if (keys.length > 0) {
      await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
        }),
      );
    }
    token = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (token);
}
