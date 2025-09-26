<script>
import BookmarkIcon from '../assets/icons/bookmark.svg'
import CoverViewIcon from '../assets/icons/cover-view.svg'
import ListViewIcon from '../assets/icons/list-view.svg'

export default {
  components: {
    BookmarkIcon,
    CoverViewIcon,
    ListViewIcon,
  },
  props: ['hideBookmarks'],
  data() {
    return {
      // set to true to turn off the list view override on shared lists
      // set when the user manually toggles the view mode
      manualViewMode: false,
      showViewOptions: true,
    }
  },
  computed: {
    bookmarksCount() {
      return Object.keys(this.$store.state.user.user?.profile.bookmarks || {}).length
    },
    isShared() {
      return this.$store.getters['books/isShared']
    },
    viewMode() {
      // if this is a shared list, show in list view
      // the BooksView component uses this same condition to override viewMode
      // we cannot put this logic in store/ui since modules cannot react to $route
      return this.isShared && !this.manualViewMode ? 'list' : this.$store.state.ui.viewMode
    },
  },
  watch: {
    $route(next) {
      this.showViewOptions = next.name === 'Home' || next.name === 'Bundles'
    },
  },
  methods: {
    toggleViewMode(mode) {
      // if the view mode is overriden due to a list share, then calling toggleViewMode('covers') as-is will have no effect, since $store.state.ui.viewMode technically already is 'covers'. In this case, we have to force it to list and then back to covers so that the BooksView watch triggers.
      if (this.isShared && !this.manualViewMode && mode === 'covers') {
        this.manualViewMode = true
        this.$store.commit('ui/setViewMode', 'list')
        // changing the value back must be delayed, otherwise the BooksView watch will not trigger
        setTimeout(() => {
          this.$store.commit('ui/setViewMode', 'covers')
        })
      } else {
        this.$store.commit('ui/setViewMode', mode)
      }
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
  <aside
    class="is-flex is-flex-direction-column is-justify-content-space-between has-text-centered"
    style="height: 100%"
  >
    <!-- div must remain when hiding for justify-content: space-between -->
    <div>
      <ul v-if="!hideBookmarks" class="menu-list">
        <li>
          <a :href="null" class="bookmark-toggler" @click.prevent="toggleBookmarks">
            <BookmarkIcon
              class="fill-secondary"
              v-tippy="{
                content: !$iam('authorized')
                  ? 'Sign up or log in to save books for later!'
                  : `You have ${bookmarksCount} saved book${bookmarksCount !== 1 ? 's' : ''}`,
              }"
            />
            <span v-if="$iam('authorized')" class="badge">{{ bookmarksCount }}</span>
          </a>
        </li>
      </ul>
    </div>

    <ul v-if="showViewOptions" class="menu-list">
      <li>
        <a
          :class="{ active: viewMode === 'covers' }"
          href="#"
          @click.prevent="toggleViewMode('covers')"
        >
          <CoverViewIcon />
          <span class="icon-label">Cover</span>
        </a>
      </li>
      <li class="my-30">
        <a
          :class="{ active: viewMode === 'list' }"
          href="#"
          @click.prevent="toggleViewMode('list')"
        >
          <ListViewIcon />
          <span class="icon-label">List</span>
        </a>
      </li>
    </ul>
  </aside>
</template>

<style scoped lang="scss">
@import 'bulma/sass/utilities/_all.sass';
@import '@/assets/style/mixins.scss';

.bookmark-toggler {
  position: relative;
  user-select: none;

  &:focus,
  svg:focus {
    outline: none;
  }

  .badge {
    position: absolute;
    top: -9px;
    right: 0px;
    background: #000;
    color: #fff;
    font-size: 11px;
    font-weight: 800;
    width: 20px;
    height: 20px;
    line-height: 20px;
    border-radius: 10px;
  }
}

.menu-list a {
  color: black;
  padding: 0;

  .icon-label {
    text-transform: uppercase;
    font-size: 14px;
    font-weight: bold;
  }

  &:hover {
    @include primary(color);
    background-color: transparent;
  }

  &.active {
    @include primary(color);
    pointer-events: none;
    cursor: default;

    &.icon-label {
      color: #ccc;
    }
  }
}
</style>
