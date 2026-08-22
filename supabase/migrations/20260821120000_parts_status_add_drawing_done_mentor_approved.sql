-- Adds `drawing_done` and `mentor_approved` statuses (issue #83), slotted
-- between `drawing` and `ready` in the part manufacturing workflow.
-- Status count goes from 20 to 22. part_status_check was previously inline
-- and unnamed in 20260819120000_parts.sql (already applied — never edit in
-- place); dropped here by its verified auto-generated name and re-added
-- with an explicit name so future changes don't need name archaeology.

alter table part drop constraint part_status_check;

alter table part add constraint part_status_check check (status in (
  'designing', 'material', 'ordered', 'drawing', 'drawing_done',
  'mentor_approved', 'ready', 'cnc', 'laser', 'lathe', 'mill', 'printer',
  'router', 'manufacturing', 'outsourced', 'welding', 'scotchbrite',
  'anodize', 'powder', 'coating', 'assembly', 'done'));
