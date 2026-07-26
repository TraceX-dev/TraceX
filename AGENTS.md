# Project Instructions

- Do not run build commands automatically for verification.
- When finishing work, state that the task is complete and ask the user to verify it manually.
- In plugin id descriptions, declare each id only once at one level. If a model plugin merges a resources plugin, resource ids must stay in the resources plugin and must not be redeclared in the model plugin.

## Copyright headers

See [Licensing](./README.md#licensing) for the full picture. Two cases:

**New file, wholly TraceX-original (no code derived from Huly)** — use the PolyForm Shield header:

```
//
// Copyright © <year> TraceX SAS.
//
// Licensed under the PolyForm Shield License 1.0.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://polyformproject.org/licenses/shield/1.0.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
```

**Existing file carried over or modified from Huly** — never relicense it. Keep the original EPL 2.0 header and its original copyright line(s) (e.g. `Hardcore Engineering Inc.`, `Anticrm Platform Contributors`) untouched. If you materially modify the file, add a second copyright line below the original one, but keep the license paragraph as EPL 2.0:

```
//
// Copyright © <year> Hardcore Engineering Inc.
// Copyright © <year> TraceX SAS.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
```

When in doubt whether a file is "new" or "derived," check git blame / whether it started from an upstream Huly commit — not just whether it currently looks new.
