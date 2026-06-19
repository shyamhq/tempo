// Pure projection mappers — no octokit or DB imports.
//
// Each mapper extracts only the fields a planner needs, keeping the Agent's
// context free of the multi-KB raw GitHub payloads. Body text is truncated at
// BODY_LIMIT so a long issue description doesn't consume the context window.

const BODY_LIMIT = 2_000;

function truncate(text: string | null | undefined): string | null {
  if (!text) return null;
  return text.length > BODY_LIMIT ? `${text.slice(0, BODY_LIMIT)}…` : text;
}

// --- Shapes returned to the Agent ------------------------------------------

export type MappedLabel = { name: string };
export type MappedUser = { login: string };

export type MappedIssue = {
  number: number;
  title: string;
  state: string;
  html_url: string;
  labels: MappedLabel[];
  assignees: MappedUser[];
  user: MappedUser | null;
  body: string | null;
  created_at: string;
  updated_at: string;
};

export type MappedPullRequest = MappedIssue & {
  draft: boolean;
  merged: boolean;
  mergeable_state: string | null;
  base_ref: string;
  head_ref: string;
};

export type MappedRepo = {
  full_name: string;
  private: boolean;
  html_url: string;
  description: string | null;
  default_branch: string;
};

export type MappedSearchResult = {
  total_count: number;
  items: MappedIssue[];
};

// --- Raw payload shapes (only the fields we touch) -------------------------
// Kept deliberately loose so this file stays free of octokit type imports.
// Octokit's issue type has `assignees: …[] | null` and `labels` items that can
// be bare strings, so those are widened accordingly.

type RawLabel = { name?: string | null } | string;
type RawUser = { login?: string | null } | null;
type RawIssue = {
  number: number;
  title: string;
  state: string;
  html_url: string;
  labels?: RawLabel[] | null;
  assignees?: RawUser[] | null;
  user?: RawUser;
  body?: string | null;
  created_at: string;
  updated_at: string;
};

type RawPullRequest = RawIssue & {
  draft?: boolean | null;
  merged?: boolean | null;
  mergeable_state?: string | null;
  base: { ref: string };
  head: { ref: string };
};

type RawRepo = {
  full_name: string;
  private: boolean;
  html_url: string;
  description?: string | null;
  default_branch: string;
};

// --- Mappers ---------------------------------------------------------------

function mapLabels(labels: RawLabel[] | null | undefined): MappedLabel[] {
  return (labels ?? []).flatMap((l) => {
    // Octokit may return a bare string label name in some search results.
    if (typeof l === 'string') return l ? [{ name: l }] : [];
    return l.name ? [{ name: l.name }] : [];
  });
}

function mapAssignees(assignees: RawUser[] | null | undefined): MappedUser[] {
  return (assignees ?? []).flatMap((a) => (a?.login ? [{ login: a.login }] : []));
}

function mapUser(user: RawUser | undefined): MappedUser | null {
  return user?.login ? { login: user.login } : null;
}

export function mapIssue(raw: RawIssue): MappedIssue {
  return {
    number: raw.number,
    title: raw.title,
    state: raw.state,
    html_url: raw.html_url,
    labels: mapLabels(raw.labels),
    assignees: mapAssignees(raw.assignees),
    user: mapUser(raw.user),
    body: truncate(raw.body),
    created_at: raw.created_at,
    updated_at: raw.updated_at,
  };
}

export function mapPullRequest(raw: RawPullRequest): MappedPullRequest {
  return {
    ...mapIssue(raw),
    draft: raw.draft ?? false,
    merged: raw.merged ?? false,
    mergeable_state: raw.mergeable_state ?? null,
    base_ref: raw.base.ref,
    head_ref: raw.head.ref,
  };
}

export function mapRepo(raw: RawRepo): MappedRepo {
  return {
    full_name: raw.full_name,
    private: raw.private,
    html_url: raw.html_url,
    description: raw.description ?? null,
    default_branch: raw.default_branch,
  };
}

export function mapSearchResult(raw: {
  total_count: number;
  items: RawIssue[];
}): MappedSearchResult {
  return {
    total_count: raw.total_count,
    items: raw.items.map(mapIssue),
  };
}
