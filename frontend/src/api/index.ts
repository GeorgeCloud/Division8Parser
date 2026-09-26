// The one place the concrete client is chosen — the app always talks to the
// Flask backend through this seam.

import type { ApiClient } from './client'
import { HttpApiClient } from './http'

export const api: ApiClient = new HttpApiClient()
