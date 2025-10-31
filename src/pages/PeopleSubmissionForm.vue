<script>
import pick from 'lodash/pick'
import debounce from 'lodash/debounce'
import BalloonEditor from '@ckeditor/ckeditor5-build-balloon'
import validator from '@/mixins/validator'
import creatorTitles from '@/store/constants/creatorTitles'
import pronouns from '@/store/constants/pronouns'
import personSubmission from '@/store/constants/personSubmission'
import Content from '@/components/Content'
import PhotoUpload from '@/components/PhotoUpload'

export default {
  components: {
    Content,
    PhotoUpload,
  },
  mixins: [
    validator(function () {
      return [
        !this.submission.bio && { name: 'bio', message: 'Bio required' },
        Object.values(this.submission.identities || {}).length === 0 && {
          name: 'identity',
          message: 'Identity required',
        },
        !this.submission.name && { name: 'name', message: 'Name required' },
        !this.submission.photo && { name: 'photo', message: 'Photo required' },
        !this.submission.title && { name: 'title', message: 'Title required' },
        !this.submission.website && { name: 'website', message: 'Website required' },
      ].filter(x => x)
    }),
  ],
  data() {
    return {
      ckConfig: {},
      creatorTitles,
      draftSaved: null,
      editor: BalloonEditor,
      pronouns,
      submission: this.newSubmission(),
    }
  },
  computed: {
    draftPerson() {
      return this.$store.state.user.user?.profile.draftPerson
    },
    name() {
      return this.$store.state.user.user?.profile.name
    },
    // top-level tags used as identities that are allowed to be shown on the creators form
    tags() {
      const tags = this.$store.getters['tags/topLevel']('people')
      return tags.filter(tag => tag.showOnPeopleForm)
    },
    // gender subtags that are allowed to be shown on the creators form
    tagsGender() {
      const subtagsGender = this.$store.getters['tags/subtags']('people', 'Gender')
      return subtagsGender.filter(tag => tag.showOnPeopleForm)
    },
    person() {
      /* We used to get the creator through an old person submission.
         See: commit 47ad155450f2e564ae266724a006086f395f7a46
         This was probably before personId was added to the user profile. */
      // const peopleSubmissions = this.$store.state.submissions.people.data || {}
      // const userSubmissions = this.$store.state.user.user?.profile.submissions || {}
      // const peopleSubmissionId = Object.keys(userSubmissions)
      //   .find(sid => peopleSubmissions[sid]?.type === 'people' && peopleSubmissions[sid]?.status === 'approved')
      // const personId = peopleSubmissions[peopleSubmissionId]?.peopleSubmissionId
      const personId = this.$store.state.user.user?.profile.personId
      const person = this.$store.state.people.data[personId]
      return person
    },
  },
  watch: {
    // update submission when draftPerson is first loaded
    draftPerson(next, prev) {
      if (next && !prev) {
        this.submission = {
          ...this.newSubmission(),
          // using the draft after the initial submission is confusing/wrong
          ...(!this.person && this.$store.state.user.user?.profile.draftPerson),
        }
      }
    },
    // update submission when person is first loaded
    person(next, prev) {
      if (next && !prev) {
        this.submission = this.newSubmission()
      }
    },
  },
  created() {
    this.submission = {
      ...this.newSubmission(),
      // using the draft after the initial submission is confusing/wrong
      ...(!this.person && this.$store.state.user.user?.profile.draftPerson),
    }
  },
  methods: {
    reset() {
      this.submission = this.newSubmission()
      this.errors = []
      this.clearDraft()
    },

    clearDraft() {
      this.$store.dispatch('user/savePersonSubmissionDraft', [])
      clearTimeout(this.draftSaved)
      this.draftSaved = null
    },

    /** Creates a new submission object that is either blank or copied from the existing person. */
    newSubmission() {
      const emptySubmission = personSubmission()
      return {
        ...emptySubmission,
        // name from private user profile
        name: this.name,
        // copy all relevant fields from person
        ...pick(this.person, Object.keys(emptySubmission)),
        // copy identities object, otherwise editing the form will update the person identities object by reference
        identities: this.person?.identities ? { ...this.person.identities } : {},
        ...(this.person?.id ? { personId: this.person?.id } : {}),
      }
    },

    saveDraftAndRevalidate: debounce(function () {
      this.revalidate()
      clearTimeout(this.draftSaved)
      this.$store.dispatch('user/savePersonSubmissionDraft', this.submission)
      this.draftSaved = setTimeout(() => {
        this.draftSaved = null
      }, 3000)
    }, 500),

    async submitForReview() {
      if (!this.validate()) return

      this.$store.commit('ui/setBusy', true)
      try {
        await this.$store.dispatch('submissions/people/submit', this.submission)
        this.$store.commit('ui/setBusy', false)
        this.$router.push({ name: 'Dashboard' })
      } catch (e) {
        console.error(e)
        this.errors = [{ name: 'submit', message: e.message }]
        this.$store.commit('ui/setBusy', false)
      }
    },
  },
}
</script>

<template>
  <div class="mx-20 mb-30">
    <div class="is-flex is-justify-content-center">
      <form class="is-flex-grow-1" style="max-width: 540px" @submit.prevent="submitForReview">
        <div class="mb-5">
          <a @click.prevent="$router.back" class="is-uppercase is-primary">&lt; Back</a>
        </div>

        <h1 class="title page-title divider-bottom">
          <span v-if="person"
            ><Content name="people-submission/title/person" format="label"
              >Edit public profile</Content
            ></span
          >
          <span v-else-if="$iam('owner')"
            ><Content name="people-submission/title/owner" format="label">New Person</Content></span
          >
          <span v-else
            ><Content name="people-submission/title/new" format="label"
              >Create a profile</Content
            ></span
          >
        </h1>

        <section class="basic-information">
          <div class="is-flex field">
            <!-- photo -->
            <PhotoUpload v-model="submission.photo" class="mr-30 my-40" style="width: 50%" />

            <div class="is-flex-grow-1 is-flex is-justify-content-center is-flex-direction-column">
              <!-- name -->
              <div class="field">
                <label
                  class="label"
                  :class="{ 'has-text-danger': hasError('name') }"
                  style="font-weight: bold; text-transform: uppercase"
                  >{{ !$iam('owner') ? 'Your ' : '' }}Name<sup class="required">*</sup></label
                >
                <input
                  type="text"
                  class="input"
                  v-model="submission.name"
                  @input="saveDraftAndRevalidate"
                />
              </div>

              <!-- preferred pronouns -->
              <div class="field">
                <label class="label" style="font-weight: bold; text-transform: uppercase"
                  >Pronouns</label
                >

                <div class="sublabel">
                  <div
                    v-for="pronoun of pronouns"
                    :key="pronoun.id"
                    class="control is-flex"
                    style="column-break-inside: avoid"
                  >
                    <input
                      type="radio"
                      name="pronoun"
                      :id="`pronoun-${pronoun.id}`"
                      v-model="submission.pronouns"
                      :value="pronoun.id"
                      class="checkbox mb-3 mt-1"
                    />
                    <label
                      class="label pl-2 pb-1 no-user-select"
                      :for="`pronoun-${pronoun.id}`"
                      style="cursor: pointer"
                      >{{ pronoun.text }}</label
                    >
                  </div>
                </div>
              </div>

              <!-- title -->
              <div class="field">
                <label
                  class="label"
                  :class="{ 'has-text-danger': hasError('title') }"
                  style="font-weight: bold; text-transform: uppercase"
                  >{{ !$iam('owner') ? 'Your ' : '' }}Title<sup class="required">*</sup></label
                >

                <div v-for="title of creatorTitles" :key="title.id" class="control is-flex">
                  <label style="cursor: pointer">
                    <input
                      type="radio"
                      name="title"
                      v-model="submission.title"
                      :value="title.id"
                      class="checkbox mb-3 mt-1"
                    />
                    <span class="no-user-select ml-1">{{ title.text }}</span>
                  </label>
                </div>
              </div>
            </div>
          </div>

          <!-- website -->
          <div class="field">
            <label class="label is-uppercase" :class="{ 'has-text-danger': hasError('website') }"
              ><b
                >{{ !$iam('owner') ? 'Your ' : '' }}Website or social media URL<sup class="required"
                  >*</sup
                ></b
              ></label
            >
            <input
              type="text"
              v-model="submission.website"
              @input="saveDraftAndRevalidate"
              class="input"
            />
          </div>

          <!-- identities -->
          <div class="field">
            <label class="label">
              <b
                :class="{ 'has-text-danger': hasError('identity') }"
                style="text-transform: uppercase"
                >Identity<sup class="required">*</sup></b
              >
              <div style="font-weight: normal">Please select all that apply.</div>
            </label>

            <div class="sublabel tablet-columns-2">
              <div
                v-for="tag of tags"
                :key="tag.id"
                class="control is-flex"
                style="column-break-inside: avoid"
              >
                <input
                  v-model="submission.identities[tag.id]"
                  :id="`tag-${tag.id}`"
                  :false-value="null"
                  type="checkbox"
                  class="checkbox mb-3 mt-1"
                  @input="saveDraftAndRevalidate"
                />
                <label class="label pl-2 pb-1" :for="`tag-${tag.id}`" style="cursor: pointer">{{
                  tag.tag
                }}</label>
              </div>
            </div>
          </div>

          <!-- gender -->
          <!-- (stored in identities) -->
          <div class="field">
            <label class="label">
              <b
                :class="{ 'has-text-danger': hasError('gender') }"
                style="text-transform: uppercase"
                >Gender<sup class="required">*</sup></b
              >
              <div style="font-weight: normal">Please select all that apply.</div>
            </label>

            <div class="sublabel tablet-columns-2">
              <div
                v-for="tag of tagsGender"
                :key="tag.id"
                class="control is-flex"
                style="column-break-inside: avoid"
              >
                <input
                  v-model="submission.identities[tag.id]"
                  :id="`tag-${tag.id}`"
                  :false-value="null"
                  type="checkbox"
                  class="checkbox mb-3 mt-1"
                  @input="saveDraftAndRevalidate"
                />
                <label class="label pl-2 pb-1" :for="`tag-${tag.id}`" style="cursor: pointer">{{
                  tag.tag
                }}</label>
              </div>
            </div>
          </div>

          <!-- bio -->
          <div class="field bio">
            <label class="label is-uppercase" :class="{ 'has-text-danger': hasError('bio') }"
              ><b>Bio</b><sup class="required">*</sup></label
            >
            <ckeditor
              @update:modelValue="saveDraftAndRevalidate"
              v-model="submission.bio"
              :editor="editor"
              :config="ckConfig"
              class="editor"
            />
          </div>

          <!-- awards -->
          <div class="field">
            <label class="label"
              ><b
                >List of awards and recognition{{
                  !$iam('owner') ? ' that you would like us to highlight' : ''
                }}</b
              >
              (optional)</label
            >
            <textarea
              class="textarea"
              v-model="submission.awards"
              @input="saveDraftAndRevalidate"
              style="min-height: 6em"
            />
          </div>

          <!-- bonus -->
          <div class="field">
            <label class="label"
              ><b>Links to bonus material{{ !$iam('owner') ? ' relevant to you' : '' }}</b>
              (optional)</label
            >
            <textarea
              class="input"
              v-model="submission.bonus"
              @input="saveDraftAndRevalidate"
              style="min-height: 6em"
            />
          </div>

          <!-- curateInterest -->
          <div v-if="!$iam('owner')" class="field">
            <label class="label"
              ><b>Would you be in interested in curating a picture book bundle?</b> <br />This
              entails listing your favorite 3-5 picture books (by other BIPOC creatives) that
              represent a theme of your choosing and writing a paragraph about this book
              collection.</label
            >
            <div class="control">
              <label style="cursor: pointer">
                <input
                  type="radio"
                  name="curateInterest"
                  v-model="submission.curateInterest"
                  value="Yes"
                  @input="saveDraftAndRevalidate"
                />
                <span class="no-user-select ml-1">Yes! Please send me a curation form</span>
              </label>
            </div>
            <div class="control">
              <label style="cursor: pointer">
                <input
                  type="radio"
                  name="curateInterest"
                  v-model="submission.curateInterest"
                  value="No"
                  @input="saveDraftAndRevalidate"
                />
                <span class="no-user-select ml-1">No</span>
              </label>
            </div>
            <div class="control">
              <label style="cursor: pointer">
                <input
                  type="radio"
                  name="curateInterest"
                  v-model="submission.curateInterest"
                  value="Maybe"
                  @input="saveDraftAndRevalidate"
                />
                <span class="no-user-select ml-1">Maybe, please send me more info</span>
              </label>
            </div>
          </div>
        </section>

        <hr />

        <div class="field is-grouped">
          <button
            :class="{ 'is-loading': $uiBusy }"
            class="button is-rounded is-primary mr-20"
            @click.prevent="submitForReview"
          >
            Submit{{ !$iam('owner') ? ' for review' : '' }}
          </button>
          <button class="button is-rounded" @click.prevent="reset">Reset</button>
          <button
            v-if="draftSaved"
            class="button is-flat"
            @click.prevent="saveDraftAndRevalidate"
            style="cursor: text"
          >
            Draft Saved
          </button>
        </div>

        <div v-if="errors.length" class="field">
          <p v-for="(error, i) of errors" :key="i" class="error has-text-centered is-uppercase">
            {{ error.message || 'Unknown error' }}
          </p>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use '@/assets/style/vars.scss' as *;

.required {
  position: absolute;
}

.upload-label {
  cursor: pointer;
}

.basic-information > .field {
  margin-bottom: 30px;
}

.label {
  font-weight: normal;
}

.w-100 {
  width: 100%;
}

.bio .editor {
  border-radius: 5px !important;
  border: solid 1px #ddd;
  min-height: 10rem;
  padding: 10px;
}

.search-wrap {
  position: relative;

  .search-results {
    position: absolute;
    width: 100%;
    max-height: 400px;
    overflow-y: scroll;
    left: 0;
    top: 0;
    z-index: $zField;
    background: #fff;
    border: 1px solid;

    img {
      max-height: 60px;
    }

    .media {
      margin: 0 !important;

      &:hover {
        background: #eee;
      }
    }
  }
}
</style>

<style lang="scss">
// compensate for CKEditor paragraph so that it exactly matches normal paragraph spacing
.bio .ck.ck-editor__editable_inline > :first-child {
  margin: -1px -2px -1px -1px;
}
</style>
