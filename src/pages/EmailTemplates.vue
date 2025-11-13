<script>
import EmailTemplatesEditor from '@/components/EmailTemplates/Editor'
import EmailTemplatesHelp from '@/components/EmailTemplates/Help'
import Toggle from '@/components/Toggle'
import BackLink from '@/components/BackLink'

export default {
  name: 'EmailTemplates',
  components: {
    EmailTemplatesEditor,
    EmailTemplatesHelp,
    Toggle,
    BackLink,
  },
}
</script>

<template>
  <div
    class="is-flex is-justify-content-center"
    @click.prevent="$refs.invite?.setInviteDropdown(false)"
  >
    <div class="is-flex-grow-1 mx-20" style="max-width: 760px">
      <div class="mb-5">
        <BackLink />
      </div>

      <h1 class="divider-bottom">Email Templates</h1>

      <Toggle>
        <template #label>Help</template>
        <template #content><EmailTemplatesHelp /></template>
      </Toggle>

      <section class="section px-0">
        <EmailTemplatesEditor />
      </section>
    </div>
  </div>
</template>
