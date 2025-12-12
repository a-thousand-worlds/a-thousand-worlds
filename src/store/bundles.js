import mergeOne from '@/util/mergeOne'
import managed from '@/store/modules/managed'
import filterable from '@/store/modules/filterable'

const module = mergeOne(managed('bundles'), filterable())

export default module
