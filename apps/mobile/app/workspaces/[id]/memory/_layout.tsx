import { Stack } from 'expo-router'

/** The Memory tab is its own little stack: the note list, with the editor pushed over it. */
export default function MemoryTabLayout() {
  return <Stack screenOptions={{ headerShown: false }} />
}
