import { ulid } from 'ulid';

export const newThreadId = () => `thr_${ulid()}`;
export const newSessionId = () => `ses_${ulid()}`;
export const newPlanId = () => `pln_${ulid()}`;
export const newCommentId = () => `cmt_${ulid()}`;
export const newReplyId = () => `rep_${ulid()}`;
export const newRoundId = () => `rnd_${ulid()}`;
