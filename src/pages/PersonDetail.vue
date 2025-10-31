<script>
import slugify from '@sindresorhus/slugify'

import { watchEffect } from 'vue'
import { useHead } from '@vueuse/head'
import computedFromState from '@/util/computedFromState'
import store from '@/store'
import router from '@/router'
import creatorTitles from '@/store/constants/creatorTitles'
import pronounOptions from '@/store/constants/pronouns'
import linkCreatorInBio from '@/util/linkCreatorInBio'
import BookListView from '@/components/BookListView'
import Filter from '@/components/Filter'
import Loader from '@/components/Loader'
import NotFound from '@/pages/NotFound'
import PrevNext from '@/components/PrevNext'
import Tag from '@/components/Tag'

/** Gets the person object from the url params. Not reactive. */
const getPerson = () =>
  store.getters['people/findBy'](
    'name',
    name => slugify(name) === router.currentRoute._value.params.name,
  )

/** Gets the photo url of a person. */
const getPersonPhoto = person => {
  if (!person?.photo) return ''
  return typeof person.photo === 'string'
    ? person.photo
    : person.photo.url?.startsWith('http')
    ? person.photo.url
    : ''
}

export default {
  components: {
    BookListView,
    Filter,
    Loader,
    NotFound,
    PrevNext,
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
  setup() {
    /** Gets the social title for the person. */
    const getTitle = state => {
      const person = getPerson()
      return person ? `${person.name} @ A Thousand Worlds` : null
    }

    /** Gets the social description for the person. */
    const getDescription = state => {
      const person = getPerson()
      return person ? `Read books by ${person.name} at A Thousand Worlds` : null
    }

    /** Gets the social image of the person. */
    const getImage = state => {
      const person = getPerson()
      return getPersonPhoto(person) || null
    }

    const descriptionComputed = computedFromState(getDescription)
    const imageComputed = computedFromState(getImage)
    const titleComputed = computedFromState(getTitle)

    useHead({
      title: titleComputed,
      meta: [
        { name: 'og:description', content: descriptionComputed },
        { name: 'og:image', content: imageComputed },
        { name: 'og:title', content: titleComputed },
        { name: 'twitter:description', content: descriptionComputed },
        { name: 'twitter:image', content: imageComputed },
        { name: 'twitter:title', content: titleComputed },
      ],
    })

    watchEffect(() =>
      store.dispatch('structuredData/set', {
        path: 'description',
        value: descriptionComputed.value,
      }),
    )
    watchEffect(() =>
      store.dispatch('structuredData/set', { path: 'image.url', value: imageComputed.value }),
    )
    watchEffect(() =>
      store.dispatch('structuredData/set', { path: 'headline', value: titleComputed.value }),
    )
  },
  data() {
    return {
      creatorTitles,
      editOnClick: false,
      pronounOptions,
    }
  },
  computed: {
    bgImage() {
      return this.person && getPersonPhoto(this.person)
    },
    // link the first instance of the person's name in their bio to their website
    bio() {
      return linkCreatorInBio(this.person)
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
    person() {
      const person = this.$store.getters['people/findBy'](
        'name',
        name => slugify(name) === this.$route.params.name,
      )
      this.$store.dispatch('debug', { person })
      return person
    },
    pronouns() {
      const pronounOption = this.pronounOptions.find(option => option.id === this.person?.pronouns)
      return pronounOption?.text || null
    },
    tags() {
      const peopleTags = this.$store.state.tags.people.data || {}
      return Object.keys(this.person?.identities || [])
        .map(id => peopleTags[id])
        .filter(x => x)
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
      this.$router.push({ name: 'PersonEdit', params: this.$route.params })
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
      <div class="columns mb-5">
        <div class="column is-narrow">
          <a @click.prevent="$router.back" class="is-uppercase is-primary">&lt; Back</a>
        </div>

        <PrevNext v-if="person" type="people" :item="person" class="column" />
      </div>

      <div class="is-flex is-flex-direction-row is-flex-wrap-wrap">
        <div class="column-person" :class="{ 'with-bookmarks': $store.state.ui.bookmarksOpen }">
          <div class="cover-wrapper mb-20">
            <div
              v-if="bgImage.length"
              @click.prevent="adminEditClick"
              class="cover-photo bg-secondary"
              :style="{
                backgroundImage: `url(${bgImage})`,
                cursor: editOnClick ? 'context-menu' : 'default',
                'user-select': editOnClick ? 'none' : null,
              }"
              style="color: inherit"
            />
          </div>

          <div class="title-container divider-30">
            <!-- title -->
            <div class="name">{{ title.text }}</div>
            <h1 class="title mt-5">
              <a
                @click.prevent="adminEditClick"
                style="color: inherit"
                :style="{
                  cursor: editOnClick ? 'context-menu' : 'default',
                  'user-select': editOnClick ? 'none' : null,
                }"
                >{{ person.name }}</a
              >
            </h1>

            <!-- pronouns -->
            <div v-if="pronouns" class="prounouns mt-2">{{ pronouns }}</div>

            <!-- tags -->
            <div v-if="tags" class="tags mt-20">
              <Tag
                v-for="tag of tags"
                :key="tag.id"
                :tag="tag"
                type="people"
                button-class="is-outlined"
              />
            </div>
          </div>

          <!-- bio -->
          <div v-if="person?.bio">
            <p class="person-bio" :innerHTML="bio" />
            <div class="divider-30 is-hidden-widescreen" />
          </div>
        </div>

        <div class="column-books" :class="{ 'with-bookmarks': $store.state.ui.bookmarksOpen }">
          <BookListView v-for="book of books" :key="book.id" :book="book" />
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
@use '@/assets/style/vars.scss' as *;
@use 'bulma/sass/utilities/mixins' as *;

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

.cover-photo {
  padding-top: 100%;
  width: 100%;
  border-radius: 50%;
  background-size: cover;
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
.person-bio.ck.ck-editor__editable_inline > :first-child {
  margin-top: 0px;
  margin-left: 0px;
}
</style>
