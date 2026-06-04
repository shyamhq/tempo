-- Tighten the default Space sentinel to a ULID-shaped id so it matches the
-- `SpaceId` Zod regex (`^spc_[A-Z0-9]{26}$`). Idempotent: only fires if the
-- old sentinel row still exists in this DB.
INSERT INTO `spaces` (`id`, `workspace_id`, `name`)
SELECT 'spc_00000000000000000000DEFAUL', 'wsp_default', 'General'
WHERE NOT EXISTS (SELECT 1 FROM `spaces` WHERE `id` = 'spc_00000000000000000000DEFAUL');--> statement-breakpoint
UPDATE `threads` SET `space_id` = 'spc_00000000000000000000DEFAUL' WHERE `space_id` = 'spc_default_general';--> statement-breakpoint
DELETE FROM `spaces` WHERE `id` = 'spc_default_general';
