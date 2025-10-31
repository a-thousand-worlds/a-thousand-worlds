<script>
import Groups from '@/components/ReviewSubmissions/Groups'

export default {
  name: 'ReviewSubmissions',
  components: {
    Groups,
  },
  computed: {
    label() {
      return this.type === 'books'
        ? 'Book'
        : this.type === 'bundles'
        ? 'Bundle'
        : this.type === 'people'
        ? 'People'
        : null
    },
    type() {
      return this.$route.params.type
    },
  },
}
</script>

<template>
  <div class="is-flex is-justify-content-center">
    <div class="is-flex-grow-1 mx-20" style="max-width: 760px">
      <div class="mb-5">
        <a @click.prevent="$router.back" class="is-uppercase is-primary">&lt; Back</a>
      </div>

      <h1
        class="divider-bottom is-capitalized is-flex is-justify-content-space-between is-align-items-center"
      >
        <span>Review {{ label }} Submissions</span>
        <router-link :to="{ name: 'ReviewRejectedSubmissions', params: { type } }"
          ><i
            v-tippy="{ content: `View rejected submissions` }"
            class="fa fa-trash"
            style="font-size: 22px"
        /></router-link>
      </h1>
      <Groups :type="type" />
    </div>
  </div>
</template>
