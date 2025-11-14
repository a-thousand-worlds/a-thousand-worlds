<script>
import Clipboard from 'clipboard'
import BookmarkWidget from '@/components/BookmarkWidget'
import Loader from '@/components/Loader'

export default {
  components: {
    BookmarkWidget,
    Loader,
  },
  data() {
    return {
      // controls the appearance of a checkmark icon when the link has been copied
      linkCopied: false,
      // tracks if the new share code is loading
      loadingShareCode: false,
      // the shared list code that was generated
      shareCode: null,
      // controls whether the share link and clipboard copy button are visible
      showShareLink: false,
    }
  },
  computed: {
    bookmarks() {
      return Object.keys(this.$store.state.user.user.profile.bookmarks || {}).map(id => ({
        id,
        type: this.$store.state.user.user.profile.bookmarks[id],
      }))
    },
    isbns() {
      return this.bookmarks.map(bookmark => this.$store.state.books.data[bookmark.id]?.isbn)
    },
    shareLink() {
      return this.shareCode ? `${window.location.origin}/s/${this.shareCode}` : null
    },
  },
  watch: {
    bookmarks() {
      // when bookmarks change, reset the share code and close the share link
      this.shareCode = null
      this.showShareLink = false
    },
  },
  mounted() {
    new Clipboard('#copy-link') // eslint-disable-line no-new
  },
  methods: {
    async toggleShowShareLink() {
      // close share link input (desktop only)
      if (this.showShareLink) {
        this.linkCopied = false
        this.showShareLink = false
        return
      }

      // when the share link input is shown, generate a new share code if it hasn't already been generated, or if it was reset due to changing bookmarks
      if ((!this.showShareLink || window.navigator?.share) && !this.shareCode) {
        this.loadingShareCode = true
        try {
          this.shareCode = await this.$store.dispatch('links/create', {
            type: 'books',
            data: this.isbns,
          })
        } catch (e) {
          this.$store.dispatch('ui/handleError', e)
        }
        this.loadingShareCode = false
      }

      // mobile share (https only)
      if (window.navigator?.share) {
        window.navigator.share({
          title: 'Share',
          text: `Share ${this.bookmarks.length} Books`,
          url: this.shareLink,
        })
      }
      // desktop
      else {
        this.showShareLink = true
      }
    },
    shareAll() {
      this.$store.dispatch('ui/popup', `Shareable link copied to clipboard`)
      this.linkCopied = true
    },
    unmarkAll() {
      this.$store.dispatch('user/clearBookmarks')
    },
  },
}
</script>

<template>
  <div class="bookmarks-view">
    <div v-if="bookmarks.length" class="container has-text-right mb-20">
      <Loader
        v-if="loadingShareCode"
        class="mr-1"
        style="display: inline-block; width: 1em; height: 1em"
      />
      <a
        @click.prevent="toggleShowShareLink"
        class="option-link primary-hover m-5"
        style="user-select: none"
      >
        Share List
        <i class="fa fa-share-square ml-1" />
      </a>
      <div v-if="showShareLink && !loadingShareCode" class="mt-3 mb-30">
        <div class="field has-addons">
          <div class="control is-expanded has-icons-right">
            <input type="text" class="input is-rounded" :value="shareLink" readonly />
            <span v-show="linkCopied" class="icon is-right" style="line-height: 2.5; right: 10px">
              <i class="fas fa-check" />
            </span>
          </div>
          <div class="control">
            <a
              class="button is-primary is-rounded"
              @click.prevent="shareAll"
              id="copy-link"
              :data-clipboard-text="shareLink"
            >
              <i class="fa fa-clipboard ml-1" />
            </a>
          </div>
        </div>
      </div>
    </div>

    <div v-if="bookmarks.length === 0">
      <p class="field">You don't have any bookmarks yet!</p>
      <p class="field">Click the bookmark icon on a book cover to add it to your list.</p>
      <p class="field">Click the bookmark icon in the upper right corner to close.</p>
    </div>

    <BookmarkWidget
      v-for="(bookmark, i) of bookmarks"
      :key="i"
      :bookmark="bookmark"
      class="bookmark-widget"
    />
    <div v-if="bookmarks.length" class="container has-text-right">
      <a class="option-link m-5" @click.prevent="unmarkAll">Unsave All</a>
    </div>
  </div>
</template>

<style lang="scss" scoped>
@use 'bulma/sass/utilities/mixins' as *;
@use '@/assets/style/vars.scss' as *;

a.option-link {
  color: #333;
  text-decoration: none;
  text-transform: uppercase;
}

.bookmarks-view {
  margin: 30px 20px;
  @include from($tablet) {
    margin-left: 10px;
    margin-right: 10px;
  }
}

.bookmark-widget {
  margin-bottom: 50px;
  @include from($tablet) {
    margin-bottom: 20px;
  }
}
</style>
