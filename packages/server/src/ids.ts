import { ulid } from 'ulid';

export const newThreadId = () => `thr_${ulid()}`;
export const newSpaceId = () => `spc_${ulid()}`;
export const newPlanId = () => `pln_${ulid()}`;
export const newCommentId = () => `cmt_${ulid()}`;
export const newReplyId = () => `rep_${ulid()}`;
export const newMessageId = () => `msg_${ulid()}`;
export const newAttachmentId = () => `att_${ulid()}`;
export const newVmRunId = () => `vmr_${ulid()}`;
