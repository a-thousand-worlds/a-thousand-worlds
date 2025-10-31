<script>
import validator from '@/mixins/validator'
import Loader from '@/components/Loader'

export default {
  name: 'LoginPage',
  components: {
    Loader,
  },

  mixins: [
    validator(function () {
      return [
        // email
        !this.email.length && {
          name: 'email',
          message: 'Email is required',
        },
        // name
        (this.isSignup || this.isAccount) &&
          !this.name.length && {
            name: 'name',
            message: 'Name is required',
          },
        // password
        (this.isSignup || this.isLogin) &&
          !this.password.length && {
            name: 'password',
            message: 'Password is required',
          },
      ].filter(x => x)
    }),
  ],

  data() {
    const profile = this.$store.state.user.user?.profile
    return {
      // the active tab (login or signup)
      active: this.getActiveFromUrl(),
      email: profile?.email || '',
      name: profile?.name || '',
      bipoc: null,
      disableAfterSave: false,
      disableResetPassword: false,
      // true if the form has been submitted and is waiting for a response
      loading: false,
      password: '',
      // after a successful login, there is a delay before the user is redirected
      // use this to provide additional visual feedback (Loader)
      redirecting: false,
      // only show errors after a submit has been attempted
      submitAttempt: false,
    }
  },

  computed: {
    // boolean role and page aliases
    isAccount() {
      return this.active === 'account'
    },
    isLogin() {
      return this.active === 'login'
    },
    isSignup() {
      return this.active === 'signup'
    },

    // other computed properties
    code() {
      return this.$route.query.code
    },
    invite() {
      return this.code ? this.$store.getters['invites/get'](this.code) : null
    },
    title() {
      return this.isSignup
        ? this.invite?.role
          ? `You have been invited to join as a ${this.invite.role}!`
          : 'Sign up for an account'
        : this.isLogin
        ? 'Log In'
        : this.isAccount
        ? 'Your Account'
        : null
    },
  },

  watch: {
    // populate name and email fields with invite data
    invite(next, prev) {
      if (next?.email && !this.email) {
        this.email = next.email
      }
      if (next?.firstName && !this.name) {
        this.name = `${next.firstName} ${next.lastName}`.trim()
      }
    },
    $route(next) {
      this.active = this.getActiveFromUrl()
    },
    '$store.state.user.user'(next, prev) {
      // redirect regular users to Home and authorized users to Dashboard
      // do not redirect on invite, which needs to redirect when roles are set
      if (!this.invite && next) {
        this.$router.push({
          name: this.$can('viewDashboard') ? 'Dashboard' : 'Home',
        })
      }

      this.email = next?.profile?.email || this.email
      this.name = next?.profile?.name || this.name
    },
    '$store.state.user.user.roles'(next, prev) {
      // redirect invited users to Dashboard
      if (this.invite && next && Object.keys(next || {}).length) {
        this.$router.push({
          name: 'Dashboard',
        })
      }
    },
  },

  methods: {
    async resetPassword() {
      this.disableResetPassword = true
      try {
        await this.$store.dispatch('user/passwordReset', this.email)
        this.$store.dispatch('ui/popup', {
          text: 'Check your email to reset your password',
          timer: 10000,
        })
      } catch (e) {
        this.disableResetPassword = false
        this.$store.dispatch('ui/popup', {
          text: 'Error resetting password',
          type: 'error',
        })
      }
    },

    /** Shows or clears an error for the given service response. */
    handleResponse(response) {
      this.loading = true
      return response
        .then(() => {
          this.loading = false
          this.disableAfterSave = false
          this.clearErrors()
        })
        .catch(err => {
          console.error(err)
          this.addError({
            // reword wrong-password error from "The password is invalid or the user does not have a password."
            message:
              err.code === 'auth/wrong-password'
                ? 'Wrong email or password'
                : err.code === 'auth/user-not-found'
                ? 'Email not registered'
                : err.message,
          })
          this.loading = false
          this.disableSend = false
        })
    },

    getActiveFromUrl() {
      return window.location.pathname === '/login'
        ? 'login'
        : window.location.pathname === '/signup'
        ? 'signup'
        : window.location.pathname === '/account'
        ? 'account'
        : null
    },

    async onEnter() {
      if (this.isLogin) {
        await this.login()
      }
    },

    async submit() {
      if (this.isSignup) {
        await this.signup()
      } else if (this.isLogin) {
        await this.login()
      } else if (this.isAccount) {
        await this.saveProfile()
      }
    },

    async login() {
      if (!this.validate()) return

      await this.handleResponse(
        this.$store.dispatch('user/login', {
          email: this.email,
          password: this.password,
        }),
      )

      // handle response will set loading to false, but we need to keep loading = true until the user watch kicks in to redirect to the dashboard
      // this occurs with a fast network and slow CPU
      this.loading = true

      // use redirecting to render a Loader so there is some indication to the user that something has changed
      this.redirecting = true
    },

    async signup() {
      if (!this.validate()) return

      return this.handleResponse(
        this.$store.dispatch('user/signup', {
          // if a contributor is invited but is not BIPOC, watchUsers will set their role to a regular user
          bipoc: this.bipoc,
          code: this.code,
          email: this.email,
          name: this.name,
          password: this.password,
        }),
      )
    },

    async saveProfile() {
      if (!this.validate()) return

      clearTimeout(this.messageTimeout)
      clearTimeout(this.disableAfterSaveTimeout)
      this.disableAfterSave = true

      this.loading = true

      await this.$store.dispatch('user/updateEmail', this.email).catch(err => {
        console.error(err)
        this.addError({
          message:
            err.code === 'auth/requires-recent-login'
              ? 'Changing your email requires a recent login. Please log in again before attempting this change.'
              : err.message,
        })
        this.loading = false
        this.disableSend = false
      })

      if (!this.hasErrors()) {
        await this.handleResponse(
          this.$store
            .dispatch('user/updateProfile', {
              name: this.name,
              email: this.email,
            })
            .then(() => {
              if (!this.hasErrors()) {
                this.$store.dispatch('ui/popup', {
                  text: 'Account updated',
                  type: 'success',
                })
              }
            }),
        )
      }
    },

    setActive(active) {
      this.active = active
      this.clearErrors()

      this.$router.push({
        name: this.isSignup ? 'Signup' : this.isLogin ? 'Login' : this.isAccount ? 'Account' : null,
      })
    },
  },
}
</script>

<template>
  <div class="mx-6">
    <div v-if="isAccount" class="mb-5">
      <a @click.prevent="$router.back" class="is-uppercase is-primary">&lt; Back</a>
    </div>

    <div v-if="(code && !invite) || invite?.used" class="is-flex is-justify-content-center mt-20">
      <div v-if="!$store.state.invites.loaded" class="my-50 has-text-centered">
        <Loader />
      </div>
      <div v-else class="my-50 has-text-centered">
        <h2>
          {{
            invite?.used ? 'This invitation code has already been used.' : 'Invalid invitation code'
          }}
        </h2>
        <router-link :to="{ name: 'Login' }"
          ><button class="button is-primary is-rounded is-uppercase mt-20">
            Log In
          </button></router-link
        >
      </div>
    </div>

    <div v-else class="is-flex is-justify-content-center">
      <form class="is-flex-grow-1" style="max-width: 490px" @submit.prevent="submit">
        <!-- Cannot use are-small and is-rounded until #3208 is merged. See https://github.com/jgthms/bulma/pull/3208. -->
        <div v-if="isLogin || (isSignup && !code)" class="buttons is-centered has-addons">
          <button
            :class="['button', 'is-small', 'is-rounded', ...[isSignup ? ['is-selected'] : null]]"
            style="width: 50%; max-width: 240px"
            @click.prevent="setActive('signup')"
          >
            Sign Up
          </button>
          <button
            :class="['button', 'is-small', 'is-rounded', ...[isLogin ? ['is-selected'] : null]]"
            style="width: 50%; max-width: 240px"
            @click.prevent="setActive('login')"
          >
            Log In
          </button>
        </div>

        <div>
          <h1 class="title page-title divider-bottom">{{ title }}</h1>

          <div class="is-flex field">
            <!-- name -->
            <div class="is-flex-grow-1 is-flex is-justify-content-center is-flex-direction-column">
              <div v-if="isSignup || isAccount" class="field">
                <label :class="['label', { error: hasError('name') }]"
                  >NAME<sup class="required">*</sup></label
                >
                <div class="control">
                  <input
                    v-model="name"
                    :disabled="loading"
                    type="text"
                    class="input"
                    :class="{ 'is-danger': hasError('name') }"
                    @input="revalidate"
                  />
                </div>
              </div>

              <!-- email -->
              <div v-if="isLogin || isSignup || isAccount" class="field">
                <label :class="['label', { error: hasError('email') }]"
                  >EMAIL<sup class="required">*</sup></label
                >
                <div class="control">
                  <input
                    v-model="email"
                    @keypress.enter.prevent="onEnter"
                    type="email"
                    class="input"
                    :class="{ 'is-danger': hasError('email') }"
                    @input="revalidate"
                  />
                </div>
              </div>

              <!-- password -->
              <div v-if="isLogin || isSignup" class="field">
                <label :class="['label', { error: hasError('password') }]"
                  >PASSWORD<sup class="required">*</sup></label
                >
                <div class="control">
                  <input
                    v-model="password"
                    :disabled="loading"
                    type="password"
                    class="input"
                    :class="{ 'is-danger': hasError('password') }"
                    @keypress.enter.prevent="onEnter"
                    @input="revalidate"
                  />
                </div>
              </div>

              <!-- BIPOC -->
              <div
                v-if="invite?.role === 'contributor' || invite?.role === 'creator'"
                class="field"
              >
                <label class="label"
                  >Do you identify as
                  <abbr
                    v-tippy="{ content: 'Black, Indigenous, and People of Color' }"
                    style="text-decoration: underline dotted"
                    >BIPOC</abbr
                  >?</label
                >
                <div>
                  <label
                    ><input type="radio" v-model="bipoc" name="bipoc" :value="true" /> Yes</label
                  >
                </div>
                <div>
                  <label
                    ><input type="radio" v-model="bipoc" name="bipoc" :value="false" /> No</label
                  >
                </div>
              </div>
            </div>
          </div>

          <!-- BIPOC message -->
          <h3 v-if="bipoc === false" class="mb-20">
            Currently we are only accepting
            <abbr
              v-tippy="{ content: 'Black, Indigenous, and People of Color' }"
              style="text-decoration: underline dotted"
              >BIPOC</abbr
            >
            contributors, but thank you for your interest. We would love for you to join as an ally
            instead!
          </h3>

          <!-- submit -->
          <div class="field my-4">
            <input
              :disabled="loading || disableAfterSave"
              type="submit"
              class="button is-primary is-rounded is-fullwidth is-uppercase"
              :class="{ 'is-loading': loading }"
              :value="
                isLogin
                  ? 'Log In'
                  : isAccount
                  ? 'Save'
                  : isSignup
                  ? bipoc === false
                    ? 'Join as ally'
                    : 'Create Account'
                  : null
              "
            />
          </div>

          <!-- error message -->
          <div v-if="hasErrors()" class="field">
            <p
              v-for="(error, i) of getErrors()"
              :key="i"
              class="error has-text-centered is-uppercase"
            >
              {{ error.message || 'Unknown error' }}
            </p>
          </div>

          <p v-if="isLogin" class="has-text-centered">
            <router-link :to="{ name: 'PasswordReset' }">FORGOT PASSWORD?</router-link>
          </p>

          <p v-if="isAccount" class="has-text-centered">
            <button
              class="button is-flat"
              :disabled="disableResetPassword"
              @click.prevent="resetPassword"
            >
              Reset Password
            </button>
          </p>

          <div v-if="redirecting" class="my-50 has-text-centered">
            <Loader />
          </div>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped lang="scss">
.required {
  position: absolute;
}

.field:not(:last-child) {
  margin-bottom: 30px;
}
</style>
