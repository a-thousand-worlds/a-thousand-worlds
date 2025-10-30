<script>
import Group from '@/components/ReviewSubmissions/Group'
import Loader from '@/components/Loader'

export default {
  components: {
    Group,
    Loader,
  },
  props: {
    status: {
      type: String,
      validator: value => ['approved', 'pending', 'rejected'].indexOf(value) !== -1,
      default: 'pending',
    },
    type: {
      type: String,
      required: true,
      validator: value => ['books', 'bundles', 'people'].indexOf(value) !== -1,
    },
  },
  computed: {
    loaded() {
      return this.$store.state.submissions[this.type].loadedAll
    },
    submissions() {
      const submissions = this.$store.getters[`submissions/${this.type}/list`]().filter(
        sub => sub && sub.status === this.status,
      )
      this.$store.dispatch('debug', { submissions })
      return submissions
    },
    submissionsGroups() {
      const groups = this.submissions.reduce((acc, sub) => {
        if (!acc[sub.group]) acc[sub.group] = {}
        acc[sub.group][sub.id] = sub
        return acc
      }, {})
      return Object.keys(groups).map(gid => {
        const subs = Object.keys(groups[gid]).reduce((acc, sid) => [...acc, groups[gid][sid]], [])
        return {
          id: gid,
          at: subs[0].createdAt,
          by: subs[0].createdBy,
          [this.type]: subs,
        }
      })
    },
  },
  methods: {
    async approveAll() {
      this.$store.commit('ui/setBusy', true)
      try {
        await this.$store.dispatch(`submissions/${this.type}/approve`, this.submissions)
        this.$store.dispatch('ui/popup', 'All submissions approved')
      } catch (e) {
        this.$store.dispatch('ui/popup', `Approve Submissions Error: ${e.message}`)
      } finally {
        this.$store.commit('ui/setBusy', false)
      }
    },
  },
}
</script>

<template>
  <div>
    <div
      v-if="submissionsGroups.length && status === 'pending'"
      class="is-flex is-justify-content-flex-end"
    >
      <div>
        <button :disabled="$uiBusy" class="button is-rounded" @click="approveAll">
          Approve all ({{ submissions.length }})
        </button>
      </div>
    </div>

    <div v-if="!loaded" class="mt-60 has-text-centered">
      <Loader />
    </div>

    <p v-else-if="submissionsGroups.length === 0" style="font-size: 20px">
      No submissions to review
    </p>

    <div v-else>
      <div v-for="(group, gid) of submissionsGroups" :key="gid" class="sub-group py-20">
        <Group :group="group" :type="type" :status="status" />
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use '@/assets/style/mixins.scss' as *;

.sub-group {
  @include primary(border-bottom-color);
  padding-top: 2rem;
  margin-top: 2rem;
  border-bottom: 1px solid;
}
.sub-group:last-child {
  border: none;
}
</style>
