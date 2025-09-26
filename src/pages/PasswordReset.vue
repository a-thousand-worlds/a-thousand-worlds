<script>
import validator from '@/mixins/validator'

export default {
  name: 'PasswordResetPage',
  mixins: [
    validator(function () {
      return [
        this.email.length === 0 && {
          name: 'email',
          message: 'Email is required',
        },
      ].filter(x => x)
    }),
  ],
  data() {
    return {
      email: '',
    }
  },
  watch: {
    '$store.state.user.user'(next, prev) {
      if (!prev && !!next) {
        this.$router.push({ name: 'Dashboard' })
      }
    },
  },
  methods: {
    /** Shows or clears an error for the given service response. */
    handleResponse(response) {
      this.loading = true
      return response
        .then(() => {
          this.loading = false
          this.clearErrors()
        })
        .catch(err => {
          console.error(err)
          this.loading = false
          this.addError({
            message: err.message,
          })
        })
    },

    resetPassword() {
      if (!this.validate()) return
      this.handleResponse(this.$store.dispatch('user/passwordReset', this.email))
    },
  },
}
</script>

<template>
  <div class="is-flex is-justify-content-center">
    <form class="is-flex-grow-1" style="max-width: 480px" @submit.prevent="resetPassword">
      <!-- Cannot use are-small and is-rounded until #3208 is merged. See https://github.com/jgthms/bulma/pull/3208. -->
      <div class="buttons is-centered has-addons">
        <button
          :class="['button', 'is-small', 'is-rounded']"
          style="width: 50%; max-width: 240px"
          @click.prevent="$router.push({ name: 'Signup' })"
        >
          Sign Up
        </button>
        <button
          :class="['button', 'is-small', 'is-rounded']"
          style="width: 50%; max-width: 240px"
          @click.prevent="$router.push({ name: 'Login' })"
        >
          Log In
        </button>
      </div>

      <h1 class="title page-title divider-bottom">Password Reset</h1>

      <div class="field">
        <label :class="['label', { error: hasError('email') }]">EMAIL</label>
        <div class="control">
          <input
            v-model="email"
            type="email"
            :class="{ 'is-danger': hasError('email') }"
            class="input"
          />
        </div>
      </div>

      <div class="field">
        <input type="submit" class="button is-primary w-100" value="RESET PASSWORD" />
      </div>

      <div class="has-text-centered">
        <p><router-link :to="{ name: 'Login' }">LOG IN</router-link></p>
        <p><router-link :to="{ name: 'Signup' }">SIGN UP</router-link></p>
      </div>

      <!-- error message -->
      <div v-if="hasErrors()" class="field my-4">
        <p v-for="(error, i) of getErrors()" :key="i" class="error has-text-centered is-uppercase">
          {{ error.message || 'Unknown error' }}
        </p>
      </div>
    </form>
  </div>
</template>

<style></style>
