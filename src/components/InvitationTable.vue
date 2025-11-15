<script>
import Clipboard from 'clipboard'
import dayjs from 'dayjs'
export default {
  name: 'InvitationTable',
  props: {
    invites: Array,
    fields: {
      type: Array,
      default: () => ['createdAt', 'email', 'name', 'role'],
      // possible values
      // ['createdAt', 'used', 'cancelled', 'email', 'name', 'role', 'resend', 'cancel'],
    },
  },
  emits: ['cancel', 'resend'],
  data() {
    return {
      resendDisabled: {},
    }
  },
  computed: {
    inviteLink() {
      return ''
    },
  },
  mounted() {
    new Clipboard('.copy-link') // eslint-disable-line no-new
  },
  methods: {
    cancel(invite) {
      this.$emit('cancel', invite)
    },
    copied(invite) {
      this.$store.dispatch(
        'ui/popup',
        `Invitation link for ${invite.firstName} ${invite.lastName} copied to clipboard`,
      )
    },
    resend(invite) {
      this.$emit('resend', invite)
      this.resendDisabled[invite.code] = true
    },
    /** Return the appropriate date based on fields. */
    date(invite) {
      const dateField = this.fields.includes('cancelled')
        ? 'cancelled'
        : this.fields.includes('used')
          ? 'used'
          : 'createdAt'
      // date field was incorrectly set to true instead of a date in earlier versions of the code, so make sure it gets ignored
      return invite[dateField] && invite[dateField] !== true ? this.format(invite[dateField]) : '--'
    },
    format(date) {
      return dayjs(date).format('MMMM DD, YYYY')
    },
    signupLink(invite) {
      return `${window.location.origin}/signup?code=${invite.code}`
    },
  },
}
</script>

<template>
  <table class="table w-100">
    <thead>
      <tr>
        <th>Date</th>
        <th>Name</th>
        <th>Email</th>
        <th>Role</th>
        <th />
      </tr>
    </thead>
    <tbody>
      <tr v-for="invite of invites" :key="invite.code">
        <td>{{ date(invite) }}</td>
        <td v-if="fields.includes('name')">
          {{ invite.firstName }} {{ invite.lastName
          }}{{ !invite.firstName && !invite.lastName ? '--' : '' }}
        </td>
        <td v-if="fields.includes('email')">{{ invite.email }}</td>
        <td class="is-capitalized">{{ invite.role }}</td>
        <td class="nowrap">
          <button
            v-if="fields.includes('resend')"
            class="copy-link is-flat mx-2"
            :data-clipboard-text="signupLink(invite)"
            v-tippy="{ content: 'Copy invitation link to clipboard' }"
            @click="copied(invite)"
          >
            <i class="fas fa-link" />
          </button>
          <button
            v-if="fields.includes('resend')"
            class="is-flat mx-2"
            v-tippy="{ content: 'Resend invitation' }"
            :disabled="resendDisabled[invite.code]"
            @click="resend(invite)"
          >
            <i class="fas fa-paper-plane" />
          </button>
          <button
            v-if="fields.includes('cancel')"
            class="is-flat mx-2"
            v-tippy="{ content: 'Cancel invitation' }"
            @click="cancel(invite)"
          >
            <i class="fas fa-times" />
          </button>
          <!-- <button v-if="fields.includes('profile')" class="is-flat" v-tippy="{ content: 'View profile' }">
            <i class="fas fa-user"></i>
          </button> -->
        </td>
      </tr>
    </tbody>
  </table>
</template>
