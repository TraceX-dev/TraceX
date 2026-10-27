<script lang="ts">
  import { Button, Notification, NotificationToast } from '@hcengineering/ui'
  import support, { contactUsLink } from '@hcengineering/support'
  import view from '@hcengineering/view'

  export let onRemove: () => void
  export let notification: Notification
</script>

<NotificationToast title={notification.title} severity={notification.severity} onClose={onRemove}>
  <svelte:fragment slot="content">
    {notification.subTitle}
  </svelte:fragment>
  <svelte:fragment slot="buttons">
    <div style="width: auto" />
    <a href={contactUsLink} target="_blank" rel="noreferrer">
      <Button label={support.string.ContactUs} stopPropagation={false} kind="primary" />
    </a>
  </svelte:fragment>
</NotificationToast>
