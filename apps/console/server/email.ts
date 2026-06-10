import { render } from '@react-email/components';
import { Resend } from 'resend';
import WorkspaceInviteEmail from '../emails/workspace-invite';
import { env } from '../env';
import { logger } from '../logger';

// Failure is non-blocking: the Clerk invite is already created and recoverable.
// Logging is the only signal — there's no retry queue in the MVP.
export async function sendWorkspaceInvite(args: {
  to: string;
  inviterName: string;
  workspaceName: string;
  inviteUrl: string;
}): Promise<void> {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
    logger.warn({ to: args.to }, 'sendWorkspaceInvite: Resend not configured, skipping');
    return;
  }
  try {
    const html = await render(WorkspaceInviteEmail(args));
    const resend = new Resend(env.RESEND_API_KEY);
    const { error } = await resend.emails.send({
      from: env.RESEND_FROM_EMAIL,
      to: args.to,
      subject: `${args.inviterName} invited you to ${args.workspaceName} on Tempo`,
      html,
    });
    if (error) {
      logger.error({ err: error, to: args.to }, 'sendWorkspaceInvite: resend send error');
    }
  } catch (err) {
    logger.error({ err, to: args.to }, 'sendWorkspaceInvite: unexpected failure');
  }
}
