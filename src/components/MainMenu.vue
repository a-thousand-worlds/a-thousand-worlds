<script>
export default {
  methods: {
    logout() {
      this.$store.dispatch('user/logout')
    },
  },
}
</script>

<template>
  <aside class="menu">
    <ul class="menu-list is-flex-grow-1">
      <li>
        <router-link
          :to="{ name: 'Home' }"
          :class="{
            'router-link-active': $route.name === 'BookDetail' || $route.name === 'BookEdit',
          }"
          >Books</router-link
        >
      </li>
      <li id="books-filter-menu" />
      <li>
        <router-link
          :to="{ name: 'People' }"
          :class="{
            'router-link-active': $route.name === 'PersonDetail' || $route.name === 'PersonEdit',
          }"
          >People</router-link
        >
      </li>
      <li id="people-filter-menu" />
      <li><router-link :to="{ name: 'Bundles' }">Book Bundles</router-link></li>
      <li id="bundles-filter-menu" />
      <li><router-link :to="{ name: 'Support' }">Support</router-link></li>
      <li><router-link :to="{ name: 'About' }">About</router-link></li>
      <li><router-link :to="{ name: 'Contact' }">Contact</router-link></li>
      <li v-if="!$iam('authorized')"><router-link :to="{ name: 'Login' }">Log In</router-link></li>
      <li v-if="$iam('authorized')">
        <router-link :to="{ name: 'Dashboard' }">Dashboard</router-link>
      </li>

      <li v-if="$iam('authorized')"><a @click.prevent="logout">Log Out</a></li>
    </ul>

    <ul class="menu-list mt-30">
      <li>
        <a
          href="https://www.instagram.com/_athousandworlds_/"
          target="_blank"
          class="social-icon is-inline mr-20"
          ><i class="fab fa-instagram is-primary"
        /></a>
        <a
          href="https://www.facebook.com/A-Thousand-Worlds-102421671707042/?view_public_for=102421671707042"
          target="_blank"
          class="social-icon is-inline mr-20"
          ><i class="fab fa-facebook-f is-primary"
        /></a>
        <a href="https://twitter.com/worlds_thousand" target="_blank" class="social-icon is-inline"
          ><i class="fab fa-twitter is-primary"
        /></a>
      </li>
    </ul>
  </aside>
</template>

<style scoped lang="scss">
@use '@/assets/style/mixins.scss' as *;

.menu-list a {
  color: black;
  font-size: 18px;
  font-weight: bold;
  text-transform: uppercase;
  padding: 0 0 20px 0;

  &.router-link-active {
    @include primary(color);
  }

  &:hover {
    background: none;
    @include primary(color);
  }
}

.social-icon i {
  font-size: 24px;
}
</style>
