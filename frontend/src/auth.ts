import { create } from 'zustand'
import { api, post } from './api'
import type { User } from './types'

interface AuthState {
  user: User | null
  ready: boolean
  refresh: () => Promise<void>
  login: (email: string, password: string) => Promise<void>
  register: (email: string, displayName: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  ready: false,
  refresh: async () => {
    try {
      set({ user: await api<User>('/me'), ready: true })
    } catch {
      set({ user: null, ready: true })
    }
  },
  login: async (email, password) => {
    set({ user: await post<User>('/auth/login', { email, password }) })
  },
  register: async (email, displayName, password) => {
    set({ user: await post<User>('/auth/register', { email, displayName, password }) })
  },
  logout: async () => {
    await post('/auth/logout')
    set({ user: null })
  },
}))
