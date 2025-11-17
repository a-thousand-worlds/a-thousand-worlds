<script>
import PersonDetailLink from '@/components/PersonDetailLink'

export default {
  components: {
    PersonDetailLink,
  },
  props: ['person'],
  computed: {
    bgImage() {
      if (!this.person.photo) return ''
      return typeof this.person.photo === 'string'
        ? this.person.photo
        : this.person.photo.url?.startsWith('http')
          ? this.person.photo.url
          : ''
    },
  },
}
</script>

<template>
  <PersonDetailLink :person="person">
    <div :style="{ backgroundImage: `url(${bgImage})` }" class="photo-wrapper bg-secondary mb-20" />
    <span class="is-uppercase">{{ person.name }}</span>
  </PersonDetailLink>
</template>

<style scoped lang="scss">
a {
  color: #000;
  font-size: 110%;
}

.photo-wrapper {
  width: 100%;
  padding-top: 100%;
  border-radius: 50%;
  background-size: cover;
}
</style>
