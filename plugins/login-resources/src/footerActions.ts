//
// Copyright © 2026 Intabia Fusion
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//
import { writable } from 'svelte/store'
import type { BottomAction } from './index'

/**
 * Bottom links that render below the login/signup card (outside it), e.g.
 * "Login with a code instead" or "Continue as a guest". Pages that want to
 * show such links set this store on mount and clear it (set to []) on
 * destroy; `LoginApp.svelte` renders whatever is currently in it.
 */
export const loginFooterActions = writable<BottomAction[]>([])
