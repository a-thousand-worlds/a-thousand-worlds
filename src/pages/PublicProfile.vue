<script>
import BackLink from '@/components/BackLink'
import Content from '@/components/Content'
import PublicProfileForm from '@/components/Dashboard/PublicProfileForm'

export default {
  components: {
    BackLink,
    Content,
    PublicProfileForm,
  },
}
</script>

<template>
  <div class="mx-20 mb-30">
    <div class="is-flex is-justify-content-center">
      <div>
        <div class="mb-5">
          <BackLink />
        </div>

        <h1 class="page-title divider-bottom">
          <Content name="contributor-profile/title" format="label">Edit Profile</Content>
        </h1>

        <PublicProfileForm />
      </div>
    </div>
  </div>
</template>
