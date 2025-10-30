<script>
import Book from './Book'
import Person from './Person'
import engagements from '@/store/constants/engagements'

export default {
  components: {
    Book,
    Person,
  },
  props: {
    group: {
      required: true,
    },
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
  data() {
    return {
      submitter: null,
      submitterLoading: true,
    }
  },
  computed: {
    submitterName() {
      if (this.submitterLoading) return ''
      return this.submitter.name || `${this.submitter.firstName} ${this.submitter.lastName}`
    },
    submitterRoles() {
      if (this.submitterLoading) return ''
      return Object.keys(this.submitter.affiliations?.selectedEngagementCategories || {})
        .map(code => {
          if (!this.submitter.affiliations.selectedEngagementCategories[code]) return ''
          if (code === 'other') return this.submitter.affiliations.otherEngagementCategory
          return engagements.find(engagement => engagement.id === code)?.text || ''
        })
        .filter(line => line && line.length)
        .join(', ')
    },
    submitterwebsite() {
      if (this.submitterLoading || !this.submitter.affiliations?.website?.length) return null
      return this.submitter.affiliations.website
    },
    submitterOrganization() {
      if (this.submitterLoading || !this.submitter.affiliations?.organization?.length) return null
      return this.submitter.affiliations.organization
    },
    submitterOrganizationLink() {
      if (
        this.submitterLoading ||
        !this.submitter.affiliations?.organizationLink?.startsWith('http')
      )
        return null
      return this.submitter.affiliations.organizationLink
    },
  },
  created() {
    this.$store.dispatch('users/loadOne', this.group.by).then(submitter => {
      this.submitter = submitter.profile
      this.submitterLoading = false
    })
  },
  methods: {
    async approveGroup() {
      this.$store.commit('ui/setBusy', true)
      await this.$store.dispatch(`submissions/${this.type}/approve`, this.group[this.type])
      this.$store.commit('ui/setBusy', false)
      this.$store.dispatch('ui/popup', 'Submission approved')
    },
  },
}
</script>

<template>
  <div>
    <p v-if="!group?.[type]?.length" style="font-size: 20px">No submissions to review</p>

    <div v-else>
      <!-- approve -->
      <div v-if="status !== 'approved'">
        <button
          @click="approveGroup"
          :disabled="$uiBusy"
          class="level-item is-flat is-underlined is-uppercase"
          v-tippy="{ content: `Approve submission and add to public directory` }"
        >
          Approve
        </button>
      </div>

      <!-- book/person review -->
      <div v-for="(sub, i) of group[type]" :key="i">
        <Book v-if="type === 'books'" :submission="sub" />
        <Person v-if="type === 'people'" :submission="sub" />
      </div>

      <!-- submitter -->
      <div v-if="type !== 'people'" class="has-text-right mt-20">
        <span v-tippy="{ content: `Submitted by` }">
          <a v-if="submitterwebsite" target="_blank" :href="submitterwebsite">{{ submitterName }}</a
          ><span v-else>{{ submitterName }}</span
          >{{ submitterRoles ? `, ${submitterRoles}` : '' }}
          <span v-if="submitterOrganization">
            <span class="ml-1">at</span>
            <a
              target="_blank"
              class="ml-1"
              v-if="submitterOrganizationLink"
              :href="submitterOrganizationLink"
              >{{ submitterOrganization }}</a
            >
            <span class="ml-1" v-else>{{ submitterOrganization }}</span>
          </span>
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use '@/assets/style/mixins.scss' as *;

.level-item:hover:not([disabled]) {
  @include primary(color);
}
</style>
