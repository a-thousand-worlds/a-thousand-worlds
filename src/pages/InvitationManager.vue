<script>
import InvitationTable from '@/components/InvitationTable'
import BackLink from '@/components/BackLink'
import { dateComparator } from '@/util/dateComparator'

export default {
  name: 'InvitationManager',
  components: {
    InvitationTable,
    BackLink,
  },
  computed: {
    cancelledInvites() {
      // eslint-disable-next-line fp/no-mutating-methods
      const sorted = Object.values(this.invites)
        .filter(invite => invite.cancelled)
        .sort(dateComparator('cancelled'))
      return sorted
    },
    invites() {
      return this.$store.getters['invites/getAll']()
    },
    pendingInvites() {
      // eslint-disable-next-line fp/no-mutating-methods
      return Object.values(this.invites)
        .filter(invite => !invite.used && !invite.cancelled)
        .sort(dateComparator('createdAt'))
    },
    acceptedInvites() {
      // eslint-disable-next-line fp/no-mutating-methods
      return Object.values(this.invites)
        .filter(invite => invite.used)
        .sort(dateComparator('used'))
    },
  },
  methods: {
    cancel(invite) {
      this.$store.dispatch('invites/save', {
        path: `${invite.code}/cancelled`,
        value: Date.now(),
      })
      this.$store.dispatch('ui/popup', 'Invitation cancelled')
    },
    async resend(invite) {
      await this.$store.dispatch('invites/send', invite)
      this.$store.dispatch('ui/popup', 'Invitation sent!')
    },
  },
}
</script>

<template>
  <div class="is-flex is-justify-content-center">
    <div class="is-flex-grow-1 mx-20" style="max-width: 760px">
      <div class="mb-5">
        <BackLink />
      </div>

      <h1 class="divider-bottom">Invitations</h1>

      <section class="my-30">
        <h2>Pending</h2>
        <InvitationTable
          v-if="pendingInvites.length"
          :invites="pendingInvites"
          :fields="['created', 'email', 'name', 'role', 'resend', 'cancel']"
          @resend="resend"
          @cancel="cancel"
        />
        <p v-else>There are no pending invitations.</p>
      </section>

      <section class="my-30">
        <h2>Accepted</h2>
        <InvitationTable
          v-if="acceptedInvites.length"
          :invites="acceptedInvites"
          :fields="['used', 'email', 'name', 'role', 'profile']"
        />
        <p v-else>There are no accepted invitations.</p>
      </section>

      <section class="my-30">
        <h2>Cancelled</h2>
        <InvitationTable
          v-if="cancelledInvites.length"
          :invites="cancelledInvites"
          :fields="['cancelled', 'email', 'name', 'role']"
        />
        <p v-else>There are no cancelled invitations.</p>
      </section>
    </div>
  </div>
</template>

<style scoped lang="scss"></style>
