<script>
import { useHead } from '@vueuse/head'
import store from '@/store'
import Content from '@/components/Content'
import HeartIcon from '@/assets/icons/heart.svg'
import Loader from '@/components/Loader'
import sendEmail from '@/util/sendEmail'

const variants = {
  'Nominate BIPOC Leader(s) to A Thousand Worlds':
    'Thank you! Please list their names, title (i.e. editor, librarian, book reviewer, teacher, etc) and contact info!',
  'I am a BIPOC Leader in the book industry':
    'You are a superstar! Please share what your title is or how you engage with picture books. Thank you for your interest in contributing to our picture book directory!',
  'Partnership Opportunity': 'Message',
  'Feedback and Questions about A Thousand Worlds': 'Message',
  'Report a Bug': 'What I expected to have happen:\n\nWhat actually happened:\n',
  Other: 'Message',
}

export default {
  name: 'Contact',
  components: {
    Content,
    HeartIcon,
    Loader,
  },
  setup() {
    const description = `Contact us! We'd love to hear from you!`
    useHead({
      meta: [
        { name: 'og:description', content: description },
        { name: 'twitter:description', content: description },
      ],
    })
    store.dispatch('structuredData/set', { path: 'description', value: description })
  },
  data() {
    const query = new URLSearchParams(decodeURI(window.location.search))
    const ret = {
      name: query.get('from') || '',
      email: query.get('email') || '',
      subject: query.get('subject') || '',
      message: query.get('message') || '',
      dropdown: query.get('subject') || '',
    }
    return ret
  },
  computed: {
    subjectVariants() {
      return Object.keys(variants)
    },
    messagePlaceholder() {
      return variants[this.subject] || 'Message'
    },
    isValid() {
      return this.name.length && this.email.length && this.subject.length && this.message.length
    },
  },
  methods: {
    setSubject(i) {
      if (i !== undefined) {
        this.dropdown = this.subjectVariants[i]
      }
      this.subject = this.dropdown === 'Other' ? '' : this.dropdown
    },
    sendEmail() {
      this.$store.commit('ui/setBusy', true)
      sendEmail({
        to: process.env.VUE_APP_ADMIN_EMAIL,
        replyTo: `${this.name} <${this.email}>`,
        subject: this.subject,
        body: `<i>Message from <a href="mailto:${this.email}">${this.email}</a>. You can reply directly to this email.</i><br><br>${this.message}`,
      })
        .then(() => {
          this.$store.dispatch('ui/popup', { text: 'Message sent!', autoclose: true })
          this.name = ''
          this.email = ''
          this.subject = ''
          this.message = ''
        })
        .catch(err => {
          console.log('sending message error', err)
          this.$store.dispatch('ui/popup', {
            text: err,
            autoclose: false,
          })
        })
        .finally(() => {
          this.$store.commit('ui/setBusy', false)
        })
    },
  },
}
</script>

<template>
  <div class="columns m-30">
    <div class="column p-0 is-three-fifths-desktop is-offset-one-fifth-desktop is-text-centered">
      <Content
        name="contact/title"
        class="contact-page-title page-title is-uppercase"
        format="multiline"
      >
        We want to hear from you!
      </Content>
    </div>
  </div>

  <div class="columns">
    <div class="column p-0 is-half-desktop is-offset-one-quarter-desktop">
      <div class="columns is-mobile">
        <div class="column is-6-mobile has-text-right">
          <HeartIcon
            class="fill-primary pr-5"
            :style="{
              width: '140px',
              height: '140px',
            }"
          />
        </div>
        <div class="column is-flex is-align-items-center">
          <div>
            <p>
              <a
                href="#"
                :class="{ 'is-text-color': dropdown !== subjectVariants[0] }"
                @click.prevent.stop="setSubject(0)"
                >Nominate a Leader</a
              >
            </p>
            <p>
              <a
                href="#"
                :class="{ 'is-text-color': dropdown !== subjectVariants[1] }"
                @click.prevent.stop="setSubject(1)"
                >Say Hello</a
              >
            </p>
            <p>
              <a
                href="#"
                :class="{ 'is-text-color': dropdown !== subjectVariants[2] }"
                @click.prevent.stop="setSubject(2)"
                >Partner with Us</a
              >
            </p>
            <p>
              <a
                href="#"
                :class="{ 'is-text-color': dropdown !== subjectVariants[3] }"
                @click.prevent.stop="setSubject(3)"
                >Ask a Question</a
              >
            </p>
            <p>
              <a
                href="#"
                :class="{ 'is-text-color': dropdown !== subjectVariants[4] }"
                @click.prevent.stop="setSubject(4)"
                >Report a Bug</a
              >
            </p>
            <p>
              <a
                href="#"
                :class="{ 'is-text-color': dropdown !== subjectVariants[5] }"
                @click.prevent.stop="setSubject(5)"
                >Other</a
              >
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="columns m-40">
    <div class="column p-0 is-half-desktop is-offset-one-quarter-desktop">
      <div class="field">
        <div class="control has-icons-right">
          <input
            :disabled="$store.state.ui.busy"
            class="input"
            type="text"
            placeholder="Name"
            v-model="name"
          />
        </div>
      </div>

      <div class="field">
        <input
          :disabled="$store.state.ui.busy"
          class="input"
          type="email"
          placeholder="Email"
          v-model="email"
        />
      </div>

      <div class="field">
        <select
          required
          :disabled="$store.state.ui.busy"
          class="select"
          v-model="dropdown"
          @change="setSubject()"
        >
          <option value="" disabled>Choose a subject</option>
          <option v-for="subj in subjectVariants" :key="subj" class="subject-opt">
            {{ subj }}
          </option>
        </select>
      </div>

      <div v-if="dropdown === 'Other'" class="field">
        <input
          :disabled="$store.state.ui.busy"
          class="input"
          type="text"
          placeholder="Subject"
          v-model="subject"
        />
      </div>

      <div class="field">
        <textarea
          :disabled="$store.state.ui.busy"
          rows="7"
          class="textarea"
          :placeholder="messagePlaceholder"
          v-model="message"
        />
      </div>

      <div class="has-text-right">
        <Loader
          v-if="$store.state.ui.busy"
          class="mr-10"
          style="width: 2em; height: 2em; display: inline-block; margin-top: 1em"
        />
        <button
          :disabled="$store.state.ui.busy || !isValid"
          type="submit"
          class="button is-primary is-uppercase is-rounded mt-3"
          @click="sendEmail"
        >
          Send
        </button>
      </div>
    </div>
  </div>
</template>

<style lang="scss">
$placeholderColor: #a0a0a0;

.contact-page-title {
  font-size: 40px;
  // not sure why page-title is !important, but we have to override it
  margin-bottom: 0 !important;
  text-align: center !important;
}
.fa-address-card {
  padding-top: 11px;
  font-size: 18px;
}

.select {
  color: #363636;
  border-color: #dbdbdb;
  border-radius: 4px;
  box-shadow: inset 0 0.0625em 0.125em rgb(10 10 10 / 5%);
  font-size: 1rem;
  padding: 7px;
  width: 100%;
}

.select:invalid {
  color: $placeholderColor;
}
.select option:first-child {
  display: none;
}
.select option {
  color: black;
}

::placeholder {
  color: $placeholderColor !important;
}

.is-text-color {
  color: black !important;
}

.ck.ck-editor__editable_inline > :first-child,
.ck.ck-editor__editable_inline > :last-child {
  margin-top: 0px !important;
  margin-bottom: 0px !important;
}
</style>
