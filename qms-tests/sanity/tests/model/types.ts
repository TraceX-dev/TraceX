//
// Copyright © 2026 TraceX SAS.
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
export interface NewDocument {
  location?: Location
  template: string
  title: string
  description: string
  reason?: string
  reviewers?: Array<string>
  approvers?: Array<string>
}

export interface Location {
  space?: string
  parent?: string
}

export interface UserSignUp {
  firstName: string
  lastName: string
  email: string
  password: string
}

export enum DocumentStatus {
  DELETED = 'Deleted',
  DRAFT = 'Draft',
  IN_REVIEW = 'In Review',
  IN_APPROVAL = 'In Approval',
  REVIEWED = 'Reviewed',
  REJECTED = 'Rejected',
  APPROVED = 'Approved',
  EFFECTIVE = 'Effective',
  ARCHIVED = 'Archived'
}

export interface DocumentDetails {
  type: string
  category: string
  version: string
  status: string
  owner: string
  author: string
  id?: string
}

export enum DocumentRights {
  VIEWING = 'Viewing',
  EDITING = 'Editing',
  COMPARING = 'Comparing'
}

export interface NewTemplate {
  docPrefix?: string
  location?: Location
  title: string
  description: string
  code?: string
  category?: string
  reason?: string
  reviewers?: Array<string>
  approvers?: Array<string>
}

export interface NewCategory extends UpdateCategory {
  title: string
  code: string
}

export interface UpdateCategory {
  description: string
  attachFileName?: string
}
