<script>
import BookmarkIcon from '@/assets/icons/bookmark.svg'
import BooksIcon from '@/assets/icons/books.svg'
import BundlesIcon from '@/assets/icons/bundles.svg'
import FilterIcon from '@/assets/icons/filter.svg'
import ContactIcon from '@/assets/icons/contact.svg'

export default {
  components: {
    BookmarkIcon,
    BundlesIcon,
    BooksIcon,
    FilterIcon,
    ContactIcon,
  },
  computed: {
    bookmarksCount() {
      return Object.keys(this.$store.state.user.user?.profile.bookmarks || {}).length
    },
    filters() {
      return this.$store.state[this.filterType].filters
    },
    tags() {
      return this.$store.getters[`tags/${this.filterType}/listSorted`]().filter(
        tag => tag.showOnFront,
      )
    },
    filterType() {
      return this.$route.name === 'People' || this.$route.name === 'PersonDetail'
        ? 'people'
        : this.$route.name === 'Bundles' || this.$route.name === 'BundleDetail'
          ? 'bundles'
          : 'books'
    },
  },
  methods: {
    isFiltered(filter) {
      const filters = this.filters || []
      return filters.some(
        activeFilter =>
          activeFilter.id === filter.id &&
          (!filter.submenu || filter.submenu.id === activeFilter.submenu?.id),
      )
    },
    resetFilters() {
      this.$store.dispatch(`${this.filterType}/resetFilters`)
    },
    setFilters() {
      const options = [...this.$refs.select.options]
      const selected = options
        // ignore reset option
        .filter(option => option.selected && option.value !== '_reset')
        .map(option => this.tags.find(tag => tag.id === option.value))
      this.$store.dispatch(`${this.filterType}/setFilters`, selected)
    },
    toggleBookmarks() {
      if (!this.$iam('authorized')) {
        this.$router.push({ name: 'Login' })
        return
      }
      const state = this.$store.state.ui.bookmarksOpen
      this.$store.commit('ui/setBookmarksOpen', !state)
    },
  },
}
</script>

<template>
  <!-- place bookmarksOpen class on container to allow router-link-active to be disabled for all links. -->
  <section
    class="menu mobile-bottom-nav has-text-centered is-uppercase"
    :class="{ bookmarksOpen: $store.state.ui.bookmarksOpen }"
  >
    <ul class="menu-list my-10">
      <li style="position: relative">
        <select
          ref="select"
          @change="setFilters"
          multiple
          style="position: absolute; overflow: hidden; left: 0: top: 0; overflow: hidden; min-width: 60px; max-width: 100px; width: 70px; height: 100%; font-size: 20px; cursor: pointer; opacity: 0; text-transform: uppercase;"
        >
          <!-- <option @click="resetFilters" value="_reset">Reset Filter</option> -->
          <optgroup disabled hidden />
          <option
            v-for="tag of tags"
            :key="tag.id"
            :selected="isFiltered(tag)"
            :value="tag.id"
            @click="setFilters"
          >
            {{ tag.tag }}
          </option>
        </select>
        <FilterIcon />
        <label class="mt-2">Filter</label>
        <span v-if="filters?.length > 0" class="badge">{{ filters?.length }}</span>
      </li>

      <li>
        <router-link
          :to="{ name: 'Home' }"
          :class="{ 'router-link-active': $route.name === 'PersonDetail' }"
        >
          <BooksIcon />
          <label class="mt-2">Books</label>
        </router-link>
      </li>

      <li v-if="$hasFeature($features.BUNDLE)">
        <router-link
          :to="{ name: 'Bundles' }"
          :class="{ 'router-link-active': $route.name === 'PersonDetail' }"
        >
          <BundlesIcon />
          <label class="mt-2">Bundles</label>
        </router-link>
      </li>
      <li v-else>
        <router-link
          :to="{ name: 'Contact' }"
          :class="{ 'router-link-active': $route.name === 'PersonDetail' }"
        >
          <ContactIcon />
          <label class="mt-2">Contact</label>
        </router-link>
      </li>

      <li>
        <a
          class="bookmarks-toggler"
          href="#"
          @click.prevent="toggleBookmarks"
          :class="{ 'router-link-active': $store.state.ui.bookmarksOpen }"
        >
          <BookmarkIcon class="fill-secondary" />
          <label class="mt-2">Saved Items</label>
          <span v-if="$iam('authorized')" class="badge">{{ bookmarksCount }}</span>
        </a>
      </li>
    </ul>
  </section>
</template>

<style lang="scss" scoped>
@use '@/assets/style/mixins.scss' as *;
@use '@/assets/style/vars.scss' as *;

.mobile-filters {
  @include primary(border-top-color);
  border-top: 1px solid;
  position: fixed;
  bottom: 0;
  left: 0;
  width: 100%;
  height: auto;
  background: #fff;
  padding: 10px 10px 110px 10px;

  button.filter {
    background: none;
    border: none;

    &.toggled {
      background: $lightgrey;
      border: 0;
    }
  }
}

.mobile-bottom-nav {
  @include primary(border-top-color);
  width: 100%;
  position: fixed;
  bottom: 0;
  border-top: solid 1px;
  background-color: white;
  font-size: 10px;
  font-weight: bold;
  white-space: nowrap;
  overflow: auto;

  .title {
    font-size: 20px;
    margin: 0;
  }

  .menu-list {
    // margin: auto is better than justify-content: center here
    // https://stackoverflow.com/a/34455253/480608
    margin: auto;

    li {
      display: inline-block;
      width: 24%;
      min-width: 60px;
      max-width: 100px;
    }

    a,
    a:hover,
    a:active,
    a:focus {
      background-color: transparent;
      color: black;
    }

    label {
      display: block;
    }
  }

  // do not highlight non-bookmark links when bookmarks are open
  // add .menu-list for greater specificity than default .menu-list a
  // must go after .menu-list for Saved Items to have more specificity than default .menu-list a
  &:not(.bookmarksOpen) .menu-list .router-link-active,
  a.bookmarks-toggler.router-link-active {
    @include primary(color);
  }
}

.bookmarks-toggler {
  position: relative;
}

.badge {
  position: absolute;
  top: -5px;
  right: 25px;
  background: #000;
  color: #fff;
  font-size: 11px;
  font-weight: 800;
  width: 20px;
  height: 20px;
  line-height: 20px;
  border-radius: 10px;
}
</style>
