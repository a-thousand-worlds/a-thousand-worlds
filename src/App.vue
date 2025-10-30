<script>
import { useHead } from '@vueuse/head'
import BookmarksView from '@/components/BookmarksView'
import Confirm from '@/components/ui/Confirm'
import ImpersonateHeader from '@/components/ImpersonateHeader'
import LeftBar from '@/components/LeftBar.vue'
import MobileFooter from '@/components/MobileFooter'
import MobileHeader from '@/components/MobileHeader'
import Popups from '@/components/ui/Popups'
import Prompt from '@/components/ui/Prompt'
import RightBar from '@/components/RightBar.vue'
import WelcomeDismissable from '@/components/WelcomeDismissable'
import Loader from '@/components/Loader'

const description = 'Colorful Reads X Colorful People'
const image = '/social/home.png'
const title = 'A Thousand Worlds'
const twitter = 'worlds_thousand'

export default {
  name: 'App',
  components: {
    BookmarksView,
    Confirm,
    ImpersonateHeader,
    LeftBar,
    Loader,
    MobileFooter,
    MobileHeader,
    Popups,
    Prompt,
    RightBar,
    WelcomeDismissable,
  },
  setup() {
    // default meta tags
    useHead({
      title: 'A Thousand Worlds',
      meta: [
        // open graph
        { name: 'og:description', content: description },
        { name: 'og:image', content: `${window.location.origin}${image}?fbreset=1` },
        { name: 'og:title', content: title },
        { name: 'og:type', content: 'article' },
        { name: 'og:url', content: window.location.href },

        // twitter
        { name: 'twitter:card', content: 'summary_large_image' },
        { name: 'twitter:description', content: description },
        { name: 'twitter:image', content: `${window.location.origin}${image}` },
        { name: 'twitter:site', content: '@' + twitter },
        { name: 'twitter:title', content: title },
        { name: 'twitter:url', content: window.location.href },

        // facebook
        { name: 'fb:pages', content: '102421671707042' },
        { name: 'article:opinion', content: 'false' },
        { name: 'article:content_tier', content: 'free' },
      ],
    })
  },
  data() {
    return {
      description,
      image,
      title,
      twitter,
    }
  },
  computed: {
    showRightBar() {
      return (
        !this.$route?.meta?.access ||
        this.$route?.name === 'BookEdit' ||
        this.$route?.name === 'PersonEdit' ||
        this.$route?.name === 'BundleEdit'
      )
    },
    showWelcome() {
      // do not show welcome banner until route is loaded
      // $route.name is undefined on initial load
      // window.location.pathname is available immediately
      return (
        (window.location.pathname === '/' || this.$route.name) &&
        !this.$store.state.ui.lastVisited &&
        !this.$route.meta?.access &&
        this.$route.name !== 'Login'
      )
    },
  },
  watch: {
    $route(next) {
      this.showMobileFilter = next.name === 'Home' || next.name === 'Bundles'
    },
  },
  async created() {
    // set ld+jsdon structured data
    const baseUrl = window.location.origin
    this.$store.dispatch('structuredData/set', { path: 'description', value: this.description })
    this.$store.dispatch('structuredData/set', { path: 'image.url', value: baseUrl + this.image })
    this.$store.dispatch('structuredData/set', {
      path: 'publisher.logo',
      value: {
        '@type': 'ImageObject',
        url: `${baseUrl}/logo/logo${this.$store.state.theme}.png`,
        width: 2176,
        height: 725,
      },
    })
    this.$store.dispatch('structuredData/set', { path: 'headline', value: this.title })

    // initialize store subscriptions
    this.$store.dispatch('loadCache')
    this.$store.dispatch('subscribe')
  },
}
</script>

<template>
  <!-- Render the page without any layout. Used by social-image collage.-->
  <div v-if="$route.meta?.noLayout">
    <router-view />
  </div>

  <!-- Full Website -->
  <div v-else :class="`theme${$store.state.theme}`">
    <ImpersonateHeader />
    <MobileHeader class="is-hidden-tablet" />

    <WelcomeDismissable v-if="showWelcome" />

    <div class="site columns m-0" :class="{ 'border-top': showWelcome }">
      <section class="leftbar column is-narrow is-hidden-mobile px-20 py-30">
        <LeftBar :animateLogo="showWelcome" />
      </section>
      <section
        class="main column px-0 pb-20"
        :class="{ 'with-bookmarks': $store.state.ui.bookmarksOpen }"
      >
        <Popups />
        <Confirm />
        <Prompt />
        <div v-if="$store.state.ui.pageLoading" class="has-text-centered" style="margin-top: 20vh">
          <Loader />
        </div>
        <router-view />
      </section>

      <section v-if="$store.state.ui.bookmarksOpen" class="bookmarks column">
        <BookmarksView />
      </section>

      <!-- add the rightbar-border to main instead of rightbar itself in order to get correct z-indexing with welcome banner -->
      <div v-if="showRightBar" class="rightbar-border is-hidden-mobile" />
    </div>

    <!-- do not show rightbar on dashboard pages -->
    <section v-if="showRightBar" class="rightbar is-hidden-mobile">
      <!-- Hide bookmarks when welcome message is shown not only for UX but also because we cannot accomplish the correct layering with z-indexes due to circularity: rightbar > main > welcome > rightbar. -->
      <RightBar :hideBookmarks="showWelcome" />
    </section>

    <MobileFooter class="is-hidden-tablet" />
  </div>
</template>

<style lang="scss">
html {
  min-height: 100%;
}

body {
  min-height: 100%;
}

#app {
  min-height: 100%;
  overflow: auto;
}
</style>

<style lang="scss" scoped>
@use 'bulma/sass/utilities';
@use '@/assets/style/vars.scss' as *;
@use '@/assets/style/mixins.scss' as *;
@use 'bulma/sass/utilities/mixins' as *;

.leftbar {
  height: 100%;
  min-height: 100vh;
  left: 0;
  width: $leftbar-width !important;
  //overflow-y: scroll;
  top: 0;
}

.rightbar {
  position: fixed;
  height: 100%;
  right: 0;
  top: 0;
  padding: 10px;
  padding-top: 30px;
  width: $rightbar-width;
}

.bookmarks {
  margin-right: $rightbar-width;
  height: 100%;

  @include until($tablet) {
    margin-left: 0px;
    margin-right: 0px;
    margin-top: 40px;
    margin-bottom: $mobile-footer-height;
  }
}

.site {
  // box-shadow for welcome banner
  // doesn't look great with dark on light design
  // box-shadow: white 0px -10px 20px 0px;
  background: $background;
  position: relative;
}

.main {
  padding-top: 30px;
  margin-right: $rightbar-width;

  &.with-bookmarks {
    @include primary(border-right-color);
    border-right: solid 1px;
    margin-right: 0.75rem;
  }

  @include until($tablet) {
    margin-left: 0px;
    margin-right: 0px;
    margin-top: 20px;
    margin-bottom: $mobile-footer-height;

    &.with-bookmarks {
      display: none;
    }
  }

  @include from($tablet) {
    @include primary(border-left-color);
    border-left: solid 1px;
  }
}

.rightbar-border {
  @include primary(border-left-color);
  border-left: solid 1px;
  width: $rightbar-width;
  position: absolute;
  right: 0;
  top: 0;
  height: 100%;
}

.border-top {
  @include primary(border-top-color);
  border-top: solid 1px;
}
</style>
