<script>
import PersonDetailLink from '@/components/PersonDetailLink'
import Square from '@/components/Square'

export default {
  components: {
    PersonDetailLink,
    Square,
  },
  computed: {
    adminEmail() {
      return process.env.VUE_APP_ADMIN_EMAIL
    },
    hasOnlyRejected() {
      const userSubmissions = Object.values(this.userSubmissions)
      return userSubmissions.length > 0 && userSubmissions.every(status => status === 'rejected')
    },
    hasPendingSubmission() {
      return (
        !this.$store.state.user?.impersonate &&
        Object.values(this.userSubmissions).some(status => status === 'pending')
      )
    },
    peopleSubmissionId() {
      const peopleSubmissions = this.$store.state.submissions.people.data || {}
      return Object.keys(this.userSubmissions).find(
        sid =>
          peopleSubmissions[sid]?.type === 'people' && peopleSubmissions[sid].status === 'approved',
      )
    },
    person() {
      if (this.$store.state.user.impersonate) {
        return {}
      }

      // searches for the person id based on the submission and logged in user
      const getPersonId = () => {
        // first check user profile
        const profilePersonId = this.$store.state.user.user.profile.personId
        if (profilePersonId) return profilePersonId

        // if not found, then check people submission
        const peopleSubmissions = this.$store.state.submissions.people.data || {}
        const peopleSubmissionPersonId = peopleSubmissions[this.peopleSubmissionId]?.personId
        return peopleSubmissionPersonId
      }

      const person = this.$store.state.people.data[getPersonId()]
      return person
    },
    userSubmissions() {
      return this.$store.state.user.user.profile.submissions || {}
    },
  },
}
</script>

<template>
  <!-- pending profile -->
  <div v-if="hasPendingSubmission" class="mb-30">
    <p style="font-size: 30px">
      Thank you! A Thousand Worlds will review your profile and reach out if we have questions or
      once it's been approved.
    </p>
  </div>

  <div v-else>
    <!-- accepted profile -->
    <div v-if="person">
      <h2 class="mb-20">Your Public Profile</h2>
      <div class="columns">
        <div class="column is-one-third">
          <PersonDetailLink :person="person" class="name">
            <Square>
              <h3>View</h3>
            </Square>
          </PersonDetailLink>
        </div>

        <div class="column is-one-third">
          <router-link :to="{ name: 'PersonSubmissionForm' }">
            <Square style="border-radius: 999px">
              <h3>Edit</h3>
            </Square>
          </router-link>
        </div>
      </div>
    </div>

    <!-- new profile -->
    <div v-else>
      <p v-if="hasOnlyRejected" class="mb-20" style="font-size: 22px">
        Thank you. Your profile submission was not accepted at this time. You can reach us at
        <a :href="'mailto:' + adminEmail">{{ adminEmail }}</a> if you have any questions.
      </p>
      <h2 v-else>Please fill our your profile for the People Directory</h2>
      <div class="field is-grouped">
        <div class="control my-20">
          <router-link class="button is-primary is-rounded" :to="{ name: 'PersonSubmissionForm' }"
            >Create Profile</router-link
          >
        </div>
      </div>
    </div>
  </div>
</template>
