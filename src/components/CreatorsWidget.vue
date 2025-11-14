<script>
import slugify from '@sindresorhus/slugify'

import PersonDetailLink from '@/components/PersonDetailLink'
import creatorTitles from '@/store/constants/creatorTitles'

export default {
  components: {
    PersonDetailLink,
  },
  props: {
    book: {},
    linked: Boolean,
    // link to admin edit pages instead of public detail pages
    edit: Boolean,
  },
  emits: ['updateTitle'],
  data() {
    return {
      creatorTitles,
      authorDropdownActive: false,
      illustratorDropdownActive: false,
    }
  },
  computed: {
    peopleList() {
      return Object.keys(this.book.creators || {}).map(creatorId => ({
        person: this.$store.state.people.data?.[creatorId] || null,
        role: this.book.creators[creatorId],
      }))
    },
    authors() {
      return this.peopleList.filter(
        creator => creator.role === 'author-illustrator' || creator.role === 'author',
      )
    },
    illustrators() {
      return this.peopleList.filter(
        creator => creator.role === 'author-illustrator' || creator.role === 'illustrator',
      )
    },
    illustratorsSame() {
      return this.authors.every(creator => creator.role === 'author-illustrator')
    },
  },

  methods: {
    // function declaration needed for v-click-outside
    closeTitleDropdown() {
      this.authorDropdownActive = false
      this.illustratorDropdownActive = false
    },

    // update all creators of the given title to the new title
    // since the CreatorsWidget displays multiple creators of the same title in a comma-separated list, there isn't a good way to make a separate dropdown for each creator when there are multiple
    // so in order to update individual creators, you have to go to BookEdit
    updateTitle(titleIdOld, titleIdNew) {
      this.closeTitleDropdown()

      if (titleIdOld === titleIdNew) return

      const creatorsOld = this[titleIdOld + 's'] || this.peopleList
      const creatorsNew = creatorsOld.reduce(
        (accum, creator) => ({
          ...accum,
          [creator.person.id]:
            titleIdNew === 'author-illustrator' ? 'author-illustrator' : titleIdNew,
        }),
        {},
      )

      this.updateBook(`creators`, creatorsNew)
    },

    /** Returns true if we are on the person page for the given person. */
    personPageActive(personObject) {
      return (
        (this.$route.name === 'PersonDetail' || this.$route.name === 'PersonEdit') &&
        this.$route.params?.name === slugify(personObject?.person?.name)
      )
    },

    updateBook(field, value) {
      if (value === undefined) {
        value = field
        field = ''
      }
      this.$store.dispatch('books/update', {
        path: `${this.book.id}/${field}`,
        value,
      })
    },
  },
}
</script>

<template>
  <div class="creators-widget is-uppercase" style="margin-right: -5px">
    <div v-if="authors.length" class="mb-10">
      <!-- author title dropdown -->
      <div
        v-if="edit"
        class="dropdown mt-4 no-user-select"
        :class="{ 'is-active': authorDropdownActive }"
      >
        <div id="dropdown-menu" class="dropdown-menu" role="menu">
          <div class="dropdown-content" style="max-height: 19.5em; overflow: scroll">
            <a
              v-for="title in creatorTitles"
              :key="title.id"
              class="dropdown-item is-capitalized"
              @click.prevent="
                updateTitle(illustratorsSame ? 'author-illustrator' : 'author', title.id)
              "
            >
              {{ title.text }}
            </a>
          </div>
        </div>
      </div>

      <b class="mr-2 nowrap" style="user-select: none">
        <a
          v-if="edit"
          v-click-outside="closeTitleDropdown"
          @click.prevent.stop="authorDropdownActive = !authorDropdownActive"
          class="primary-hover"
          :class="{ 'is-primary': authorDropdownActive }"
          >{{ illustratorsSame ? '' : 'words ' }}by</a
        >
        <span v-else>{{ illustratorsSame ? '' : 'words ' }}by</span>
      </b>

      <!-- allow long names to push a few pixels into the padding before wrapping -->
      <span v-for="(person, i) of authors" :key="i">
        <PersonDetailLink
          v-if="person.person && linked && !personPageActive(person)"
          :person="person.person"
          :edit="edit"
          class="name linked"
          >{{ person.person.name }}</PersonDetailLink
        >
        <span v-else class="name">{{ person.person?.name }}</span>
        <span v-if="authors?.length > 1 && i !== authors?.length - 1" class="mr-2">,</span>
      </span>
    </div>

    <div v-if="illustrators.length && (!illustratorsSame || authors.length === 0)" class="mb-10">
      <!-- illustrator title dropdown -->
      <div
        v-if="edit"
        class="dropdown mt-4 no-user-select"
        :class="{ 'is-active': illustratorDropdownActive }"
      >
        <div id="dropdown-menu" class="dropdown-menu" role="menu">
          <div class="dropdown-content" style="max-height: 19.5em; overflow: scroll">
            <a
              v-for="title in creatorTitles"
              :key="title.id"
              class="dropdown-item is-capitalized"
              @click.prevent="updateTitle('illustrator', title.id)"
            >
              {{ title.text }}
            </a>
          </div>
        </div>
      </div>

      <b class="mr-2 nowrap" style="user-select: none">
        <a
          v-if="edit"
          v-click-outside="closeTitleDropdown"
          @click.prevent.stop="illustratorDropdownActive = !illustratorDropdownActive"
          class="primary-hover"
          :class="{ 'is-primary': illustratorDropdownActive }"
          >pictures by</a
        >
        <span v-else>pictures by</span>
      </b>

      <!-- allow long names to push a few pixels into the padding before wrapping -->
      <span v-for="(person, i) of illustrators" :key="i">
        <PersonDetailLink
          v-if="person.person && linked && !personPageActive(person)"
          :person="person.person"
          :edit="edit"
          class="name linked"
          >{{ person.person.name }}</PersonDetailLink
        >
        <span v-else class="name">{{ person.person?.name }}</span>
        <span v-if="illustrators.length > 1 && i !== illustrators?.length - 1" class="mr-2">,</span>
      </span>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use '@/assets/style/mixins.scss' as *;

.creators-widget {
  color: black !important;

  .name {
    color: #000;

    &.linked:hover {
      @include primary(color);
    }
  }
}
</style>
