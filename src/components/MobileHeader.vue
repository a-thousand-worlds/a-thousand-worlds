<script>
import HamburgerIcon from '@/assets/icons/hamburger.svg'
import MainMenu from '@/components/MainMenu.vue'

export default {
  components: {
    HamburgerIcon,
    MainMenu,
  },
  data() {
    return {
      isOpen: false,
    }
  },
  watch: {
    $route() {
      this.isOpen = false
    },
  },
}
</script>

<template>
  <!-- Add top margin equal to the height of the fixed position header. -->
  <div class="mt-40">
    <div class="back" />

    <section class="header is-flex is-justify-content-space-between is-align-items-center">
      <div class="title is-uppercase is-primary-text">
        <router-link :to="{ name: 'Home' }" class="is-primary">A Thousand Worlds</router-link>
      </div>
      <button class="menu-button" @click="isOpen = !isOpen">
        <HamburgerIcon />
      </button>
    </section>

    <section
      v-if="isOpen"
      class="submenu p-2 pt-20 has-text-centered is-align-self-stretch is-flex-direction-column is-justify-content-space-between"
    >
      <MainMenu />
    </section>
  </div>
</template>

<!-- unscoped styles -->
<style lang="scss">
// hide filters
.submenu {
  #books-filter-menu,
  #bundles-filter-menu,
  #people-filter-menu {
    display: none;
  }
}
</style>

<!-- scoped styles -->
<style lang="scss" scoped>
@use '@/assets/style/mixins.scss' as *;
@use '@/assets/style/vars.scss' as *;

.header {
  @include primary(border-bottom-color);
  background-color: white;
  border-bottom: 1px solid;
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  z-index: $zMobileHeader;
  padding: 12px 20px 8px; // compensate for font baseline being 2px too height

  .title {
    font-size: 20px;
    margin: 0;
    line-height: 1;
  }
}

.submenu {
  margin-top: 1px; // do not overlap header border
  position: fixed;
  left: 0;
  width: 100%;
  height: 100%;
  background: #fff;
  z-index: $zMobileHeader;
  // opacity: 0.8;
}

.back {
  position: fixed;
  top: 0;
  left: 0;
  content: '';
  background-color: #fff;
  width: 100%;
  height: 40px;
  z-index: $zMobileHeader;
  // opacity: 0.8;
}

.menu-button {
  background: none;
  border: none;
  cursor: pointer;

  // extend click area
  padding: 20px;
  margin: -20px;

  &:focus {
    outline: none;
  }
}
</style>
