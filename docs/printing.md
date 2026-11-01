# Document printing

Document export renders the selected document in the frontend `/print` application using the initiating user's access. It does not create a public document link. Drive embeds therefore use the user's existing access to the referenced files, rather than the narrower access of a public document guest.

## Export flow

1. The UI calls `printToPDF({ _id, _class }, token)`. The print service authenticates the request and resolves its workspace.
2. `renderDocument` creates a short-lived read-only derivative of the user's token and checks that the target document is accessible through the workspace REST client.
3. Puppeteer opens the canonical frontend URL built from `FRONT_URL`:

   ```text
   /print/{workspaceUrl}?objectClass={encodedClass}&objectId={encodedId}
   ```

4. Before navigation, the service injects the token into `sessionStorage['print-token']` for that exact top-level URL. The token is never included in the frontend URL. `PrintApp` consumes and removes this entry.
5. `PrintApp` selects the workspace, loads the document's `ObjectPanel` component (or `EditDoc`), and renders it through `EmbeddedWorkspace` with `documentOnly` enabled.
6. The service waits for document and resource readiness, prepares the print layout, and captures the result. Each request owns a browser that is closed on success, failure, or deadline.

`PrintApp` and `GuestApp` share the lightweight workspace connection and `EmbeddedWorkspace`. Printing uses the existing document panels and editors without loading the full workbench navigation. The shared UI restrictions disable editing, navigation, actions, and comments.

Single-document, bulk, and signed exports use the same document export path. Bulk export processes documents individually; signing runs after PDF generation.

## Authorization and read-only boundaries

`generateReadOnlyToken` preserves the source token's identity and extra claims, adds `extra.readonly: 'true'`, and limits expiry to the earlier of the source expiry and 180 seconds. It does not add the signing service's privileges.

The transactor copies this claim into the session context. `ReadOnlyMiddleware` rejects transactions and domain requests while preserving normal query authorization. The server client also rejects backup upload and clean operations for read-only tokens. Datalake allows read requests, including GET and HEAD, and rejects mutation requests with these tokens. The collaborative editor uses its non-editing path in a print context.

These checks cover the services used by this export flow. The claim is not a substitute for checking authorization in every other service that might accept a token.

## Opening `/print` in a browser

Open the frontend URL in a browser where the user is already signed in, for example:

```text
http://tracex.local:8087/print/ws1?objectClass=document%3Aclass%3ADocument&objectId=DOCUMENT_ID
```

Use the stored document `_id`, not the workbench URL's title/slug. Encode query values with `URLSearchParams`. This URL displays the print application; it does not itself generate a PDF.

Authentication is selected in this order:

1. An injected `print-token`, which must be a read-only user token. Invalid injected tokens are rejected rather than replaced by the ordinary session.
2. The current `presentation.metadata.Token`, if present.
3. The existing account session cookie, used by workspace selection when no explicit token is available. This supports opening a new tab or reloading the page.

Explicit guest tokens are rejected by `PrintApp`. If workspace selection or document loading fails, the page displays an access error; it does not provide an interactive login flow.

The fallback to the ordinary session exists for browser debugging. The UI remains read-only, but the ordinary token retains its normal server permissions: this fallback does not mint a restricted token. Automated document export always uses the injected read-only token.

The print application already selects static file previews. PDF generation additionally applies print media styles; use browser print preview or DevTools print-media emulation when checking pagination and page-specific CSS.

## Rendering readiness

Each `PrintApp` owns a Svelte `PrintContext`; there is no global print-session store. The context tracks document mount readiness, pending resources, and fatal rendering errors. `registerResource()` returns an idempotent completion callback.

`RenderContext` connects asynchronous component loading and editor initialization to that lifecycle. Editors finish their resource after initialization, collaborative content loading where applicable, and mounting. The common panel marks the document as mounted. Editor initialization or content rendering failures propagate to the root context.

`EmbeddedWorkspace` exposes the capture contract:

| DOM marker | Meaning |
| --- | --- |
| `[data-print-root][data-print-state="loading"]` | The document or a registered resource is pending. |
| `[data-print-root][data-print-state="ready"]` | The panel is open, the document has mounted, and no registered resources remain pending. |
| `[data-print-root][data-print-state="error"]` | Authentication, document loading, or main rendering failed. Export must fail. |

The print service checks the root before preparation and again before capture. It also waits for visible busy content and images. For PDF it switches to print media, waits two animation frames, scrolls through lazy content, and waits for fonts during PDF generation. Screenshots also wait for content readiness. Uncaught renderer errors fail authenticated document export.

Readiness checks have a 60-second root timeout; the whole browser operation has a 120-second deadline. An inaccessible or broken main document must not be returned as a successful PDF of an error page.

### File previews and Drive embeds

Drive resolves a reference to its file/version and mounts the common `FilePreview`. The Svelte context is passed through the editor's `SvelteRenderer`, so embeds inherit the print lifecycle. Drive does not select a separate print component or maintain a print-specific MIME registry.

`FilePreview` uses the registered viewers in both interactive and print modes. `FilePreviewSession` supplies loading/ready/error state, cancellation, and a 15-second deadline in print mode only. Preview type resolution and viewer loading participate in this lifecycle. Interactive previews have no such deadline.

| Content | Printed representation |
| --- | --- |
| Images | The same `ImageViewer`, `DrawingBoard`, alignment, and size calculation as ordinary viewing; editing is disabled and the print height limit is 25 cm. |
| Text and JSON | Text with wrapping and without an interactive scroll viewport. |
| PDF attachments | A first-page thumbnail from the preview service, rendered through `ImageViewer`. Pages are not appended to the parent document. |
| DOCX, audio, video, other unsupported formats | An explicit failure placeholder. Interactive converters, iframes, and players are not captured as printable content. |

Successful previews have no filename caption underneath. Failed previews identify the file and use the ordinary protected workspace source link when available; printing does not grant public access to that source. A failed, unsupported, or timed-out attachment produces a placeholder and releases its pending resource, allowing the rest of the document to export.

`fetchPreviewFile` adds the workspace bearer token only for storage identities, uses `credentials: 'omit'`, and rejects HTTP errors. It does not forward the token to external URLs. Viewers complete only after their content has loaded; images also wait for decoding.

### Mermaid diagrams

Mermaid node views register pending rendering in the same `PrintContext`. They release the resource after mounting the generated SVG. Errors and a 15-second print deadline produce a visible placeholder and release the resource; late results do not replace a timed-out placeholder. Destroying a node also releases its resource. Empty diagrams do not block printing, and ordinary editor rendering has no print deadline.

Authenticated document export does not use a separate Mermaid DOM poll. The legacy arbitrary-link export path has no print context, so it retains its older 10-second poll of `data-mermaid-render-state`; timeout there logs a warning and continues.

## Service API and configuration

The frontend `/print/{workspaceUrl}` route and the print service HTTP API are separate entry points:

| Print service request | Result |
| --- | --- |
| `GET /print?objectClass=...&objectId=...` | Stores the export in workspace storage and returns `{ "id": "..." }`. |
| `GET /print/:objectClass/:objectId` | Returns the rendered bytes directly. |
| `GET /print?link=...` | Legacy arbitrary-link rendering, with HTTP(S) and configured hostname validation. It does not provide the authenticated document readiness contract. |

Use bearer authentication for API requests. Options include `kind` (`pdf`, `jpeg`, `png`, `webp`), `orientation` (`portrait`, `landscape`), and a paired viewport `width`/`height`. PDF defaults to A4 portrait; the default browser viewport is 1440 by 900.

The service requires `SECRET`, `ACCOUNTS_URL`, and `FRONT_URL`; `PORT` defaults to 4005. `ALLOWED_HOSTNAMES` controls the legacy link allowlist, and `PUPPETEER_ARGS` supplies comma-separated browser arguments. `FRONT_URL` must be reachable from the print browser and serve the matching frontend version. PDF attachment thumbnails additionally require a working frontend `PreviewUrl` configuration and preview service.

## Verification and implementation references

For manual verification, compare a document in the editor, `/print`, and the generated PDF. Include a small image, an image wider than the page, a Drive PDF, text, a Mermaid diagram, and an inaccessible attachment. Verify that successful previews have no filename captions, attachment failures remain visible, and an inaccessible main document fails export. Check the direct browser URL both after login and after reload; verify the service's injected-token path separately.

Focused automated coverage lives in:

- [Print service tests](../services/print/pod-print/src/print.test.ts): authorization injection, document failures, PDF/screenshot readiness, browser cleanup, and legacy link readiness.
- [Mermaid tests](../plugins/text-editor-resources/src/components/extension/codeSnippets/mermaid.test.ts): SVG mount, errors, deadlines, node destruction, empty diagrams, and ordinary editor behavior.
- [Presentation tests](../packages/presentation/src/___tests___): print-context isolation, preview lifecycle, and authorized file loading.
- [Read-only middleware tests](../foundations/server/packages/middleware/src/tests/read-only.test.ts) and [token tests](../foundations/core/packages/token/src/__tests__/readonly.test.ts).

The main implementation entry points are [PrintApp](../plugins/print-resources/src/components/PrintApp.svelte), [the lightweight workspace connection](../plugins/workbench-resources/src/embedded-workspace.ts), [PrintContext](../packages/presentation/src/print.ts), [FilePreview](../packages/presentation/src/components/FilePreview.svelte), [Mermaid node views](../plugins/text-editor-resources/src/components/extension/codeSnippets/mermaid.ts), [the service routes](../services/print/pod-print/src/server.ts), and [browser capture](../services/print/pod-print/src/print.ts).
