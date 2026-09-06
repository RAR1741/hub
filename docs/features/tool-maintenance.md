# Tool maintenance & checks tracking

The shop maintains an inventory of tools and logs every inspection, maintenance, and repair performed on them. This replaces informal tracking and answers "when was the drill press last checked?" with timestamped history.

## Inventory and lifecycle

The **tool** table holds each tool with name, optional category and location tags, optional asset tag (unique, for shop-assigned serial numbers), and lifecycle status (`in_service`, `needs_attention`, `out_of_service`, or `retired`). Unlike batteries, tool names are not unique (three identical drills may coexist). Retire is a PATCH operation (no DELETE); retired tools stay in history for record-keeping and remain visible on the detail page.

## Check log

The **tool_check** table records every inspection and maintenance event: who logged it (`checked_by`), when (`checked_at`), the check kind (`inspection`, `maintenance`, or `repair`), the tool's condition on that day (`good`, `fair`, or `poor`), and an optional status flip (`status_after`: `in_service`, `needs_attention`, or `out_of_service`). A check's `status_after` applies immediately via a database trigger, but **never flips a tool into or out of `retired`** — retirement is always a deliberate PATCH operation. Deleting a mistyped check row does not revert any status change it caused. `/tools` shows active tools in order of last check (never-checked first, then oldest checked, retired last) and a form to submit a check; `/tools/[id]` shows the tool spec card and full per-tool check history.

## Deletion requests

Students cannot delete tools (bad edits are recoverable, deletes are not). Instead, they submit a **deletion request** via `/tools/[id]` with a required reason (≤500 chars). Requests appear at `/admin/requests` for mentor+ review. Approving a deletion request hard-deletes the tool and its entire check history (students may then re-request a similar tool if needed); denying keeps the tool and allows the student to re-request immediately. One pending request per tool is enforced; re-requesting after a denial creates a fresh request. Unlike battery tracking's "delete usage row" pattern, there is no deletion request flow for check rows — mentors delete them directly via a Delete button on the check row in the history.

## Due and overdue checks

The **"due" date** is computed, never stored. A tool is due for its next check when `now >= (lastCheckedAt + maintenanceIntervalDays days)`, or immediately if the tool has never been checked (baseline inspection is the intended downtime task). Tools with no interval set are never due. Retired tools are never due.

## Roles

**Student+** can view tools, create and edit tools (including retiring them), log checks, and request deletion of tools. **Mentor+** can do all of the above, plus hard-delete tools and delete check rows. Students never see a Delete button; they see a "Request deletion" form.

## Pages and access

- `/tools` — check log form (active tools in sorted order), active tool summary table (name, category, location, status badge, last checked, due or blank), and recent check history (last 50). Students see all of this; mentors also see a "New tool" panel (collapse/expand) and a collapsed list of retired tools at the bottom. Student-gated (guests redirect to `/login`).
- `/tools/[id]` — tool spec card (name, category, location, asset tag, status, maintenance interval, last checked, next due), `<details>` "Edit tool" panel (`status` `<select>` shown only here), per-tool check history, and a **Danger zone** row: if a deletion request is pending, everyone sees a pill "Deletion requested"; mentors+ see a Delete button; students without a pending request see a "Request deletion" form.

## Future work

v1 is inventory + append-only check log + student deletion requests only. Not included: checkout / check-in workflow ([#75](https://github.com/RAR1741/hub/issues/75)), certification gating ([#75](https://github.com/RAR1741/hub/issues/75)), tool reservations ([#75](https://github.com/RAR1741/hub/issues/75)), QR/barcode tags ([#75](https://github.com/RAR1741/hub/issues/75)), photos ([#75](https://github.com/RAR1741/hub/issues/75)), replacement cost tracking ([#75](https://github.com/RAR1741/hub/issues/75)), per-tool documentation links ([#75](https://github.com/RAR1741/hub/issues/75)), status-change audit log (history is check-driven only; direct PATCHes leave no row) ([#75](https://github.com/RAR1741/hub/issues/75)), Slack nudges for overdue checks ([#75](https://github.com/RAR1741/hub/issues/75)), and request flow for check-row deletion ([#75](https://github.com/RAR1741/hub/issues/75)).

## Source

`src/lib/tools.ts` (core logic, validation, due date computation), `src/lib/tool-delete-requests.ts` (request creation and approval/denial), `src/app/api/tools/` and `src/app/api/tool-checks/` (CRUD routes), `src/app/api/tool-delete-requests/` and `src/app/api/admin/requests/tool-delete/[id]/` (request routes), `src/app/tools/page.tsx` and `src/app/tools/[id]/page.tsx` (pages), `src/components/ToolForm.tsx`, `ToolCheckForm.tsx`, `ToolCheckTable.tsx`, `DeleteCheckButton.tsx`, `DeleteToolButton.tsx`, `ToolDeleteRequestForm.tsx` (UI), `src/components/RequestActions.tsx` (admin review), and the schema in `supabase/migrations/20260906120000_tool_maintenance.sql`.
