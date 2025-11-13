<script>
import dayjs from 'dayjs'
import slugify from '@sindresorhus/slugify'

import BackLink from '@/components/BackLink'
import BalloonEditor from '@ckeditor/ckeditor5-build-balloon'
import creatorTitles from '@/store/constants/creatorTitles'
import pronounOptions from '@/store/constants/pronouns'
import linkCreatorInBio from '@/util/linkCreatorInBio'
import AddTag from '@/components/AddTag'
import BookListView from '@/components/BookListView'
import Dropdown from '@/components/Dropdown'
import Filter from '@/components/Filter'
import Loader from '@/components/Loader'
import NotFound from '@/pages/NotFound'
import PersonDetailLink from '@/components/PersonDetailLink'
import PhotoUpload from '@/components/PhotoUpload'
import Tag from '@/components/Tag'
import SimpleInput from '@/components/fields/SimpleInput'

export default {
  components: {
    AddTag,
    BackLink,
    BookListView,
    Dropdown,
    Filter,
    Loader,
    NotFound,
    PersonDetailLink,
    PhotoUpload,
    SimpleInput,
    Tag,
  },
  beforeRouteLeave(to, from, next) {
    // mark the user's visit once they navigate to any other page
    // used to show the one-time welcome messagein App.vue
    if (!this.$store.state.ui.lastVisited) {
      this.$store.commit('ui/setLastVisited', new Date())
    }
    next()
  },
  data() {
    return {
      // track if the bio CKEditor is focused to prevent the auto-linked bio from being saved to the database
      bioFocused: false,
      ckConfig: {
        placeholder: 'Enter bio',
      },
      creatorTitles,
      dayjs,
      editor: BalloonEditor,
      editOnClick: false,
      pageUrl: window.location.href,
      pronounOptions,
      uploadingPhoto: false,
    }
  },
  computed: {
    bgImage() {
      if (!this.person.photo) return ''
      return typeof this.person.photo === 'string'
        ? this.person.photo
        : this.person.photo.url?.startsWith('http')
        ? this.person.photo.url
        : ''
    },
    // link the first instance of the person's name in their bio to their website
    // when the bio editable is focused, the raw bio should be returned for edits
    bio() {
      return this.bioFocused ? this.person?.bio : linkCreatorInBio(this.person)
    },
    books() {
      return this.person
        ? this.$store.getters['books/list']().filter(
            book =>
              (book.authors || []).includes(this.person.name) ||
              (book.illustrators || []).includes(this.person.name) ||
              Object.keys(book.creators || {}).includes(this.person.id),
          )
        : []
    },
    createdByName() {
      const user = this.$store.getters['users/get'](this.person?.createdBy)
      return user?.profile?.name || 'admin'
    },
    updatedByName() {
      const user = this.$store.getters['users/get'](this.person?.updatedBy)
      return user?.profile?.name || 'admin'
    },
    name() {
      return this.$route.params.name
    },
    person() {
      const person = this.$store.getters['people/findBy'](
        'name',
        name => slugify(name) === this.name,
      )
      this.$store.dispatch('debug', { person })
      return person
    },
    pronouns() {
      return this.pronounOptions.find(option => option.id === this.person?.pronouns)
    },
    tags() {
      const peopleTags = this.$store.state.tags.people.data || {}
      return Object.keys(this.person?.identities || []).map(
        id => peopleTags[id] || { id, tag: 'invalid' },
      )
    },
    /** Get the person's creatorTitle. */
    title() {
      if (!this.person) return null
      const title = this.creatorTitles.find(creatorTitle => creatorTitle.id === this.person.title)
      if (!title) {
        console.warn(`Missing titles. Defaulting to Author.`)
      }
      return title || this.creatorTitles.find(creatorTitle => creatorTitle.text === 'Author')
    },
  },
  created() {
    window.addEventListener('keydown', this.keydown)
    window.addEventListener('keyup', this.keyup)
  },
  unmounted() {
    window.removeEventListener('keydown', this.keydown)
    window.removeEventListener('keyup', this.keyup)
  },
  methods: {
    adminEditClick(e) {
      // use e.shiftKey instead of editOnClick in case shift key is held down from previous page
      if (!this.$iam('owner') || !e.shiftKey) return
      this.$router.push({ name: 'PersonDetail', params: this.$route.params })
    },

    bioBlur() {
      // ck-editor triggers blur when showing the popup link editor
      // this.bioFocused is reactively used in this.bio, so any change triggers a re-render
      // delay this.bioFocused = false and make sure the editor is actually blurred to avoid re-rendering when the popup link editor is shown, and avoid saving the autolink
      setTimeout(() => {
        const bioEl = document.querySelector('.person-bio')
        const blurred = bioEl?.classList.contains('ck-blurred')
        if (blurred) {
          this.bioFocused = false
        }
      }, 10)
    },

    bioFocus() {
      this.bioFocused = true
    },

    keydown(e) {
      if (this.$iam('owner') && e.key === 'Shift') {
        this.editOnClick = true
      }
    },

    keyup(e) {
      if (this.$iam('owner') && e.key === 'Shift') {
        this.editOnClick = false
      }
    },

    updatePhoto(photo) {
      this.uploadingPhoto = true
      return this.updatePerson('photo', photo)
        .then(() => {
          this.uploadingPhoto = false
        })
        .catch(() => {
          this.uploadingPhoto = false
        })
    },

    updateBio(value) {
      // updateBio gets triggered on focus when there is an autolink since this.bio changes
      // prevent the autolink from getting embedded by making sure the editor is focused before updating
      if (!this.bioFocused) return

      this.updatePerson({ bio: value })
    },

    updatePerson(field, value) {
      if (value === undefined) {
        value = field
        field = ''
      }

      // do not update if the field is not changed
      // handle field embedded in complex value, e.g. field === '' and value === { isbn: '1419742256' }
      if (this.person[field] === value) return
      const extractedField =
        field === '' && Object.keys(value).length === 1 && Object.keys(value)[0]
      if (extractedField && this.person[extractedField] === value[extractedField]) return

      return this.$store.dispatch('people/update', {
        path: `${this.person.id}/${field}`,
        value,
      })
    },

    saveName(name) {
      this.updatePerson({ name })

      // update route since it is includes the person's name
      this.$router.replace({
        name: this.$route.name,
        params: {
          name: slugify(name),
        },
      })
    },
  },
}
</script>

<template>
  <teleport to="#people-filter-menu">
    <Filter type="people" />
  </teleport>

  <div v-if="!$store.state.people.loaded" class="my-50">
    <Loader />
  </div>
  <div v-else-if="person" class="mx-5" :data-person-id="person.id">
    <div class="wide-page">
      <!-- back and view buttons -->
      <div class="is-flex is-justify-content-space-between mb-3">
        <div class="mb-5 is-narrow">
          <BackLink />
        </div>

        <PersonDetailLink v-if="person" :person="person" class="button is-rounded is-primary"
          >View Person</PersonDetailLink
        >
      </div>

      <div class="is-flex is-flex-direction-row is-flex-wrap-wrap">
        <div class="column-person" :class="{ 'with-bookmarks': $store.state.ui.bookmarksOpen }">
          <div class="cover-wrapper mb-20">
            <PhotoUpload
              v-model="person.photo"
              @update:modelValue="updatePhoto"
              noremove
              noMinimumSize
              :style="{ opacity: uploadingPhoto ? 0.5 : null }"
            />
          </div>

          <div class="title-container divider-30">
            <!-- title -->
            <Dropdown
              :defaultValue="person.title"
              :options="creatorTitles"
              placeholder="Choose title"
              @update:modelValue="updatePerson({ title: $event })"
              style="display: inline"
              :labelStyle="{
                fontStyle: !person.pronouns ? 'italic' : null,
              }"
            />

            <!-- name -->
            <h1 class="title mt-5">
              <a
                @click.prevent="adminEditClick"
                style="color: inherit"
                :style="{
                  cursor: editOnClick ? 'context-menu' : 'default',
                  'user-select': editOnClick ? 'none' : null,
                }"
              >
                <SimpleInput
                  v-if="person"
                  @update:modelValue="saveName"
                  v-model="person.name"
                  placeholder="Enter Name"
                  unstyled
                />
              </a>
            </h1>

            <!-- pronouns -->
            <div class="mt-2">
              <Dropdown
                :defaultValue="person.pronouns"
                :options="pronounOptions"
                placeholder="Choose pronouns"
                @update:modelValue="updatePerson({ pronouns: $event })"
                :labelStyle="{
                  fontStyle: !person.pronouns ? 'italic' : null,
                }"
              >
                <template #beforeOptions>
                  <a
                    class="dropdown-item is-capitalized is-uppercase"
                    @click.prevent="updatePerson({ pronouns: null })"
                    >None</a
                  >
                  <hr class="dropdown-divider" />
                </template>
              </Dropdown>
            </div>

            <!-- tags -->
            <div class="tags mt-20">
              <!-- tags -->
              <Tag
                v-for="tag of tags"
                :key="tag.id"
                :tag="tag"
                type="people"
                @remove="updatePerson('identities', { [tag.id]: null })"
                button-class="is-outlined"
                :tagStyle="
                  tag.tag === 'invalid'
                    ? 'background-color: #fff; border-color: red; color: red !important; cursor: pointer;'
                    : null
                "
                editable
              />

              <!-- add tag dropdown -->
              <AddTag type="people" :item="person" />
            </div>
          </div>

          <!-- bio -->
          <ckeditor
            @update:modelValue="updateBio($event)"
            :model-value="bio"
            :editor="editor"
            :config="ckConfig"
            @focus="bioFocus"
            @blur="bioBlur"
            class="person-bio"
            style="padding: 0"
          />
          <div class="divider-30" />

          <!-- information table -->
          <!-- text-align: left needed to override centered content in tablet view. -->
          <table style="text-align: left">
            <!-- Submitted by -->
            <tr>
              <th class="has-text-right"><b class="mr-3">submitted by</b></th>
              <td>
                <span style="opacity: 0.5">{{ createdByName }}</span>
              </td>
            </tr>

            <!-- Submitted on -->
            <tr>
              <th class="has-text-right"><b class="mr-3">submitted on</b></th>
              <td>
                <span style="opacity: 0.5">{{ dayjs(person?.createdAt).format('M/D/YYYY') }}</span>
              </td>
            </tr>

            <!-- Updated by -->
            <tr>
              <th class="has-text-right"><b class="mr-3">updated by</b></th>
              <td>
                <span style="opacity: 0.5">{{ updatedByName }}</span>
              </td>
            </tr>

            <!-- Updated on -->
            <tr>
              <th class="has-text-right"><b class="mr-3">updated on</b></th>
              <td>
                <span style="opacity: 0.5">{{ dayjs(person?.updatedAt).format('M/D/YYYY') }}</span>
              </td>
            </tr>

            <!-- Website -->
            <tr>
              <th class="has-text-right"><b class="mr-3">website</b></th>
              <td>
                <SimpleInput
                  v-if="person"
                  @update:modelValue="updatePerson({ website: $event })"
                  v-model="person.website"
                  placeholder="Enter a website"
                  style="display: inline-block; margin-right: 0.5em"
                />
                <a v-if="person?.website" :href="person.website" target="_blank">↗</a>
              </td>
            </tr>
          </table>

          <div class="divider-30 is-hidden-widescreen" />
        </div>

        <div class="column-books" :class="{ 'with-bookmarks': $store.state.ui.bookmarksOpen }">
          <BookListView v-for="book of books" :key="book.id" :book="book" edit />
        </div>
      </div>
    </div>
  </div>

  <!-- no person -->
  <div v-else>
    <NotFound />
  </div>

  <!-- Add a bottom spacer so that fixed position footer clears content when scrolled to the bottom. -->
  <div class="mb-7" />
</template>

<style lang="scss" scoped>
@import 'bulma/sass/utilities/_all.sass';
@import '@/assets/style/mixins.scss';
@import '@/assets/style/vars.scss';

.wide-page {
  margin: 0 20px;
  max-width: $widescreen;
  @include from($desktop) {
    margin: 0 60px;
  }
}

.directory-nav-link {
  color: black;
}

.column-person {
  width: 100%;
  text-align: center;

  @include from($widescreen) {
    width: calc(50% - 20px);
    margin-right: 20px;
    text-align: left;
  }

  &.with-bookmarks {
    width: 100%;
    text-align: center;
  }
}

.column-books {
  width: 100%;

  @include from($widescreen) {
    width: calc(50% - 20px);
    margin-left: 20px;
  }

  &.with-bookmarks {
    width: 100%;
  }
}

.cover-wrapper {
  max-width: 180px;
  max-height: 180px;
  text-align: center;
  margin: auto;

  @include from($widescreen) {
    text-align: left;
    margin: 0;
  }
}

.title {
  line-height: 1;
  margin-bottom: 0;
}

.person-bio {
  font-size: 22px;
  text-align: justify;

  @include from($widescreen) {
    text-align: left;
    padding-bottom: 0.5rem;
  }
}
</style>

<style lang="scss">
.person-bio.ck.ck-editor__editable_inline > :last-child {
  margin-bottom: 0px;
}
// override background color of injected creator link in bio
.ck .ck-link_selected {
  background: inherit;
}
</style>
