<script>
import CreatorsWidget from '@/components/CreatorsWidget'
import BookmarkButton from '@/components/BookmarkButton'
import BookDetailLink from '@/components/BookDetailLink'

export default {
  components: {
    CreatorsWidget,
    BookmarkButton,
    BookDetailLink,
  },
  props: {
    book: {
      required: true,
    },
    // link to admin edit pages instead of public detail pages
    edit: Boolean,
  },
  emits: ['loaded'],
  data() {
    return {
      // if the main image fails to load, this gets set to true and the fallback image is used
      imgErrored: false,
    }
  },
  computed: {
    coverRatio() {
      if (!this.book) return 1
      if (this.hasBookCoverUrl) return (this.book.cover.height / this.book.cover.width) * 100
      if (!this.book.coverWidth || !this.book.coverHeight) return 1
      return (this.book.coverHeight / this.book.coverWidth) * 100
    },
    bgImage() {
      if (!this.book) return null
      if (this.hasBookCoverUrl) return this.book.cover.cache || this.book.cover.url
      return this.book.cover || ''
    },
    bgFallback() {
      if (!this.book) return null
      if (this.hasBookCoverUrl) return this.book.cover.url
      return this.book.cover || ''
    },
    hasBookCoverUrl() {
      return this.book?.cover?.url?.startsWith('http')
    },
  },
  created() {
    const img = new Image()
    img.onload = () => {
      this.$emit('loaded', this.book)
    }
    img.onerror = () => {
      this.imgErrored = true
    }
    img.src = this.bgImage
  },
}
</script>

<template>
  <!-- doing v-if check because this component used for bookmarks bar also, and it may happen, that bookmarked (by some user) book may be removed from database (by admin), so book to display will be undefined -->
  <div class="columns m-0">
    <div class="column is-one-half p-0 mb-20">
      <BookDetailLink :book="book" :edit="edit" class="cover-data">
        <div
          class="img-cover bg-secondary"
          :style="{
            width: '100%',
            minWidth: !bgImage ? '100px' : null,
            minHeight: !bgImage ? '180px' : null,
            paddingTop: coverRatio + '%',
            backgroundImage: `url(${imgErrored ? bgFallback : bgImage})`,
            backgroundColor: bgImage ? 'transparent' : null,
            backgroundSize: 'contain',
            backgroundRepeat: 'no-repeat',
          }"
        />
      </BookDetailLink>
    </div>
    <div class="column is-one-half is-align-content-center p-0">
      <div class="columns is-mobile is-vcentered m-0" style="line-height: 1.25">
        <div class="column p-0 pl-20 pr-10">
          <div class="is-flex is-justify-content-space-between mb-20">
            <div>
              <BookDetailLink v-if="book?.title" :book="book" class="cover-data" :edit="edit">
                <h3 class="link mb-10 mr-15" style="margin-right: 15px">{{ book.title }}</h3>
              </BookDetailLink>
              <div v-else>
                <h3 class="mb-10" style="margin-right: 15px">Oops! Missing book</h3>
                {{ book?.id }}
              </div>
              <div v-if="book.creators" class="authors">
                <CreatorsWidget :book="book" linked :edit="edit" />
              </div>
            </div>

            <BookmarkButton :book="book" iconStyle="margin-top: 6.5px; height: 27px;" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use '@/assets/style/mixins.scss' as *;

.link {
  color: black;
  &:hover {
    @include primary(color);
  }
}

.is-vcentered {
  height: 100%;
}
</style>
