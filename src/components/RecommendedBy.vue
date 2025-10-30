<script>
import engagements from '@/store/constants/engagements'
import normalizeLink from '@/util/normalizeLink'
import PublicProfileForm from '@/components/Dashboard/PublicProfileForm'

const newContributor = () => ({
  engagements: {},
  name: '',
  organization: '',
  organizationLink: '',
  website: '',
})

export default {
  components: {
    PublicProfileForm,
  },
  props: {
    // contributor id
    modelValue: String,

    // if true, allows the contribor to be edited
    edit: Boolean,

    // if true, does not show options for New Contributor or None
    existingContributorsOnly: Boolean,

    label: {
      type: String,
      default: '–Recommended By',
    },

    labelClass: {},
    labelStyle: {},

    // specify a profile the user profile in the store
    // useful for previewing profile changes
    preview: {},
  },
  emits: ['update:modelValue'],
  data() {
    return {
      dropdownActive: false,
      newContributor: newContributor(),
      showEditContributor: false,
      showNewContributor: false,
    }
  },
  computed: {
    contributorOptions() {
      return this.$store.getters['users/contributorOptions']
    },

    // populated individually in the created hook since users are not loaded automatically except for admin
    profile() {
      // return the logged in user if the id matches (contributors)
      if (this.modelValue === this.$store.state.user.user?.uid) {
        return {
          ...this.$store.state.user.user.profile,
          ...this.preview,
        }
      }

      // otherwise lookup in users collection (admin)
      return this.modelValue && this.$store.state.users.loaded
        ? {
            id: this.modelValue,
            ...this.$store.state.users.data[this.modelValue]?.profile,
            ...this.preview,
          }
        : null
    },

    name() {
      if (!this.profile) return ''
      const fullName =
        this.profile.name ||
        (this.profile.firstName
          ? `${this.profile.firstName || ''} ${this.profile.lastName || ''}`.trim()
          : '')
      if (!fullName) {
        console.warn('User profile is missing name', this.profile)
      }
      return fullName || 'anonymous'
    },

    title() {
      const reviewerEngagements = [
        // selectedEngagementCategories
        ...(this.profile?.affiliations?.selectedEngagementCategories
          ? Object.entries(this.profile.affiliations.selectedEngagementCategories)
              .filter(([id, value]) => value)
              .map(([id, value]) => engagements.find(engagement => engagement.id === id))
              .filter(x => x)
          : []),
        // otherEngagementCategory
        ...(this.profile?.affiliations?.otherEngagementCategory
          ? [{ text: this.profile.affiliations.otherEngagementCategory.trim() }]
          : []),
      ]
      return reviewerEngagements.length > 0
        ? reviewerEngagements.map(engagement => engagement.text.trim()).join(', ')
        : null
    },

    organization() {
      return this.profile?.affiliations?.organization
    },

    organizationLink() {
      return normalizeLink(this.profile?.affiliations?.organizationLink || '')
    },

    website() {
      return normalizeLink(this.profile?.affiliations?.website || '')
    },
  },
  created() {
    // load contributor
    // not subscribed to firebase, but will reload
    this.$store.dispatch('users/loadOne', this.modelValue)
  },
  methods: {
    contributorFormSaved(newContributor) {
      if (this.showNewContributor) {
        newContributor.then(contributor => {
          this.update(contributor)
        })
      }
      this.closeDropdown()
      this.resetContributorForm()
    },

    // function declaration needed for v-click-outside
    closeDropdown() {
      this.dropdownActive = false
    },

    resetContributorForm() {
      this.newContributor = newContributor()
      this.showNewContributor = false
      this.showEditContributor = false
    },

    remove() {
      this.closeDropdown()
      this.$emit('update:modelValue', null)
    },

    update(contributor) {
      this.closeDropdown()
      this.$emit('update:modelValue', contributor.id)
    },
  },
}
</script>

<template>
  <div v-if="edit || name">
    <div v-if="!showNewContributor && !showEditContributor">
      <b v-if="label" :class="labelClass" :style="labelStyle">
        <a
          v-if="edit"
          v-click-outside="closeDropdown"
          @click.prevent.stop="dropdownActive = !dropdownActive"
          style="user-select: none"
          class="is-uppercase mr-2"
          :class="{ 'primary-hover': edit, 'is-primary': dropdownActive }"
          >{{ label }}</a
        >
        <span v-else class="is-uppercase mr-2">{{ label }}</span>
      </b>

      <!-- dropdown -->
      <div
        v-if="edit"
        class="dropdown no-user-select"
        :class="{ 'is-active': dropdownActive }"
        style="position: absolute"
      >
        <div
          id="dropdown-menu"
          class="dropdown-menu"
          role="menu"
          style="top: auto; bottom: -1.5rem"
        >
          <div class="dropdown-content" style="max-height: 19.5em; overflow: scroll">
            <a
              v-if="!existingContributorsOnly"
              class="dropdown-item is-capitalized is-uppercase"
              @click.prevent="showNewContributor = true"
              ><b>New Contributor</b></a
            >
            <a
              v-if="modelValue"
              class="dropdown-item is-capitalized is-uppercase"
              @click.prevent="showEditContributor = true"
              ><b>Edit Contributor</b></a
            >
            <a
              v-if="!existingContributorsOnly"
              class="dropdown-item is-capitalized is-uppercase"
              @click.prevent="remove"
              >None</a
            >
            <hr class="dropdown-divider" />
            <a
              v-for="contributor in contributorOptions"
              :key="contributor.id"
              class="dropdown-item is-capitalized"
              :class="{ 'is-active': contributor.id === modelValue }"
              @click.prevent="update(contributor)"
            >
              {{ contributor.text }}
            </a>
          </div>
        </div>
      </div>

      <!-- name -->
      <span v-if="name">
        <a v-if="website" :href="website" target="_blank" class="primary-hover"
          ><u>{{ name }}</u></a
        >
        <span v-else>{{ name }}</span>
      </span>
      <span
        v-else
        @click.stop="dropdownActive = !dropdownActive"
        style="opacity: 0.5; font-style: italic; cursor: pointer"
        >None</span
      >

      <!-- title -->
      <span v-if="title">, {{ title }}</span>

      <!-- organization -->
      <span v-if="organization">
        <a v-if="organizationLink" :href="organizationLink" target="_blank" class="primary-hover"
          >, <u>{{ organization }}</u></a
        >
        <i v-else>, {{ organization }}</i>
      </span>
    </div>

    <!-- New Contributor -->
    <div v-else style="max-width: 450px">
      <h2 class="divider-bottom">{{ showEditContributor ? 'Edit' : 'New' }} Contributor</h2>
      <PublicProfileForm
        :contributor="profile"
        @cancel="resetContributorForm"
        @save="contributorFormSaved"
        admin
      />
    </div>
  </div>
</template>

<style lang="scss" scoped>
.required {
  position: absolute;
}

.field {
  margin-bottom: 30px;
}

label {
  text-transform: uppercase;
}
</style>
