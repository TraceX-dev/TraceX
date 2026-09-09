import { test } from '@playwright/test'

test('Workspace migration is unavailable', async () => {
  test.skip(true, 'Workspace migration is not available in the admin panel')
})
