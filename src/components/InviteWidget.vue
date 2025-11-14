<script>
import parseRecipient from '@/util/parseRecipient'
import Loader from '@/components/Loader'

export default {
  components: {
    Loader,
  },
  data() {
    const allowedRoles = this.$allowedInviteeRoles()
    return {
      dropdownActive: false,
      expanded: false,
      emailInput: '',
      error: null,
      sending: false,
      message: null,
      role: allowedRoles.length === 1 ? allowedRoles[0] : null,
    }
  },
  computed: {
    existingInvites() {
      return this.recipients.filter(recipient =>
        this.$store.getters['invites/findBy']('email', recipient.email),
      )
    },
    existingRecipients() {
      return this.recipients.filter(recipient =>
        this.$store.getters['users/findBy']('profile.email', recipient.email),
      )
    },
    hasFieldErrors() {
      return Object.keys(this.error?.fields || {}).length > 0
    },
    invalidRecipients() {
      return this.recipients.filter(recipient => !recipient.isValid)
    },
    recipients() {
      return this.emailInput ? this.emailInput.split(/[\n,]/g).map(parseRecipient) : []
    },
  },
  mounted() {
    // update the expanded state on mouseup rather than on resize (MutationObserver) since the height will oscillate when resizing until the user releases the mouse
    document.addEventListener('mouseup', this.updateExpanded)
  },
  unmounted() {
    document.removeEventListener('mouseup', this.updateExpanded)
  },
  methods: {
    // resize the textarea to fit its content
    autosize(e) {
      const multiline = e.target.value.includes('\n')
      if (multiline) {
        e.target.style.height = 'auto'
        e.target.style.height = e.target.scrollHeight + 'px'
      } else {
        e.target.style.removeProperty('height')
      }
    },

    /** Shows or clears an error for the given service response. */
    handleResponse(response) {
      this.sending = true
      return response
        .then(() => {
          this.sending = false
          this.error = null
        })
        .catch(err => {
          console.error(err)
          this.error = {
            message: err.message,
          }
          this.sending = false
        })
    },

    hasError(field) {
      return this.error?.fields?.[field]
    },

    reset() {
      this.role = null
      this.emailInput = null
      this.error = null
    },

    async send() {
      this.closeInviteDropdown()

      if (!this.validate()) return

      const invitePromises = this.recipients.map(recipient =>
        this.$store.dispatch('invites/createAndSend', {
          recipient,
          role: this.role,
        }),
      )

      await this.handleResponse(
        Promise.all(invitePromises).then(() => {
          this.$store.dispatch('ui/popup', {
            text: `Email${this.recipients.length > 1 ? 's' : ''} sent!`,
            type: 'success',
          })
          this.reset()
        }),
      )
    },

    setInviteRole(value) {
      this.role = value
      this.dropdownActive = false
      if (this.error) {
        this.validate()
      }
    },

    // must be declared function for v-click-outside
    closeInviteDropdown() {
      this.dropdownActive = false
    },

    /** Toggles the expanded state and sets an initial height while expanded. */
    toggleExpanded() {
      const style = getComputedStyle(this.$refs.textarea)
      const height = parseFloat(style.height)
      this.$refs.textarea.style.height = this.expanded && height ? '' : '8em'
      this.expanded = !this.expanded
    },

    toggleInviteDropdown() {
      this.dropdownActive = !this.dropdownActive
    },

    // update the expanded state based on the textarea's current height
    // used after a manual resize
    updateExpanded() {
      if (!this.$refs.textarea) return
      const style = getComputedStyle(this.$refs.textarea)
      const fontSize = parseFloat(style.fontSize)
      const height = parseFloat(style.height)
      // adjust the threshold so that it's easier to collapse when expanded
      this.expanded = height > fontSize * (this.expanded ? 6 : 4)
    },

    /** Checks all fields for errors and updates this.error. */
    validate() {
      this.error = null

      if (!this.emailInput) {
        this.error = {
          message: 'Enter one or more emails',
          fields: { ...this.error?.fields, emailInput: true },
        }
      } else if (!this.role) {
        this.error = {
          message: 'Enter a role',
          fields: { ...this.error?.fields, role: true },
        }
      } else if (this.invalidRecipients.length > 0) {
        this.error = {
          message: `Invalid email${this.invalidRecipients.length > 1 ? 's' : ''}:`,
          data: this.invalidRecipients.map(recipient => recipient.raw),
          fields: { ...this.error?.fields, emailInput: true },
        }
      } else if (this.recipients.some(recipient => !recipient.firstName)) {
        this.error = {
          message: 'Name is also required, e.g. "Sarah Lopez - sarah@test.com"',
          fields: { ...this.error?.fields, emailInput: true },
        }
      } else if (this.existingRecipients.length > 0) {
        this.error = {
          message: `Already registered:`,
          data: this.existingRecipients.map(recipient => recipient.raw),
          fields: { ...this.error?.fields, emailInput: true },
        }
      } else if (this.existingInvites.length > 0) {
        this.error = {
          message: `Already Invited:`,
          data: this.existingInvites.map(recipient => recipient.raw),
          fields: { ...this.error?.fields, emailInput: true },
        }
      }

      return !this.error
    },
  },
}
</script>

<template>
  <div v-click-outside="closeInviteDropdown">
    <p v-if="expanded" class="mb-10">Enter a list of names and emails (one per line)</p>

    <div class="field">
      <div class="control">
        <div class="is-flex is-align-items-flex-end">
          <textarea
            ref="textarea"
            v-model="emailInput"
            class="textarea"
            :class="{ 'is-danger': hasError('emailInput') }"
            :placeholder="'Sarah Lopez - sarah@test.com\nDillon Avery - dillon@test.com\nMattie Smith - mattie@test.com\n...'"
            style="line-height: 1.6; min-height: 2.5rem; min-width: 100px; max-width: 700px"
            :style="!expanded ? 'padding-top: 0.5rem; padding-bottom: 0.5rem;' : ''"
            @input="autosize"
          />
          <div class="ml-2">
            <a
              v-tippy="{ content: 'Invite multiple' }"
              class="pt-2 pr-2"
              @click.prevent="toggleExpanded"
            >
              <i :class="`fas fa-angle-double-${expanded ? 'up' : 'down'}`" />
            </a>
          </div>
        </div>
      </div>
    </div>

    <div class="field is-grouped is-flex">
      <!-- <div v-if="!expanded" class="control is-flex-grow-1">
        <textarea v-model="emailInput" class="textarea" :class="{ 'is-danger': hasError('emailInput')}" placeholder="Sarah Lopez - sarah@test.com" style="min-height: 0; padding-top: 0.5rem; padding-bottom: 0.5rem;" />
      </div> -->

      <div v-if="$allowedInviteeRoles().length > 1" class="control">
        <div :class="{ dropdown: true, 'is-active': dropdownActive }">
          <div class="dropdown-trigger">
            <button
              class="button"
              aria-haspopup="true"
              aria-controls="dropdown-menu"
              @click.prevent.stop="toggleInviteDropdown"
            >
              <span>{{ role || 'CHOOSE ROLE' }}</span>
              <span class="icon is-small">
                <i class="fas fa-angle-down" aria-hidden="true" />
              </span>
            </button>
          </div>
          <div
            id="dropdown-menu"
            class="dropdown-menu"
            :class="{ 'is-danger': hasError('role') }"
            role="menu"
          >
            <div class="dropdown-content">
              <a
                v-for="userRole in $allowedInviteeRoles()"
                :key="userRole"
                class="dropdown-item is-capitalized"
                :class="{ 'is-active': role === userRole }"
                @click.prevent="setInviteRole(userRole)"
              >
                {{ userRole }}
              </a>
            </div>
          </div>
        </div>
      </div>

      <div class="control">
        <button class="button is-primary" :disabled="sending" @click.prevent="send">Invite</button>
        <Loader v-if="sending" class="ml-10" style="height: 100%" />
      </div>
    </div>

    <div v-if="message" class="field">
      <p class="message is-uppercase">{{ message }}</p>
    </div>

    <div v-if="error" class="field">
      <p class="error is-uppercase">{{ error.message || 'Unknown error' }}</p>
      <div v-if="error.data" class="error">
        <p v-for="item of error.data" :key="item">{{ item }}</p>
      </div>
    </div>
  </div>
</template>
