# Discussion visibility

A discussion (`chunter.class.Discussion`) has `visibility`:

- `public` (default) — everyone with access to the space of the parent object;
- `participants` — only the collaborators of the parent object (`core.class.Collaborator` with `attachedTo` = parent).

The restriction covers the discussion and everything inside it: messages, thread replies, activity, mentions,
attachments, reactions and their transactions. Like space security, it is bypassed by admins, the system account,
doc guests and triggers. The creator and whoever switches a discussion to `participants` become collaborators of
the parent, so they keep access.

## Where it is enforced

| Path | Implementation |
| --- | --- |
| `findAll` (main table) | Postgres rule `discussionSecurityRule` (`server-plugins/chunter-resources/src/discussionSecurity.ts`), appended to `addSecurity` via `registerSecurityRule`; registered in `pods/server` |
| `$lookup`, fulltext search | `DiscussionSecurityMiddleware` filters results |
| Query joining | the middleware sets `securityKey`, so concurrent queries of different accounts are not joined |
| Broadcast | the middleware narrows targets to the parent collaborators |
| Access changes | `SecurityChange` on visibility changes (whole space) and on collaborator changes of a parent (that account) |
| Notifications | `notification-resources` drops receivers who are not parent collaborators |

The rule and the middleware are active only in workspaces that have (or had, since the process start)
a restricted discussion, so other workspaces do not pay for them.

## Known limits

- Counters and `groupBy` (e.g. the number of discussions of an object) still count restricted discussions.
- Notifications created before access was lost are not removed.
- After a restart, the transaction history of removed restricted discussions is protected only while the workspace has
  other restricted discussions.
