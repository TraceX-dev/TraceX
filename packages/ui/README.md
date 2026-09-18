# `@hcengineering/ui`

Shared Svelte components and UI utilities used across TraceX applications and plugins.

## Usage

Import public components and utilities from the package entry point:

```svelte
<script lang="ts">
  import { Button, IconAdd } from '@hcengineering/ui'
</script>

<Button icon={IconAdd} label="Add" />
```

Do not import files from `src/components` directly. The exports in [`src/index.ts`](./src/index.ts) are the supported package entry point.

## Documentation

- [Component catalog](./docs/components.md) — public components grouped by purpose, with short usage descriptions.

The catalog is intended as a discovery guide. Component props, events, and slots remain defined by the component source and exported TypeScript types.

