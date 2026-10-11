import { Card, ExportFunc, MasterTag, Tag } from '@hcengineering/card';
import { Association, Class, Client, Doc, DocumentUpdate, Markup, ObjQueryType, Rank, Ref, Tx, Type } from '@hcengineering/core';
import { Asset, IntlString, Plugin, Resource } from '@hcengineering/platform';
import { ToDo } from '@hcengineering/time';
import { AnyComponent } from '@hcengineering/ui';
import { AttributeCategory } from '@hcengineering/view';
import { SelectedExecutionContext } from './types';
/**
 * @public
 */
export declare const processId: Plugin;
export interface SlotModel {
    slotKind: 'attribute' | 'class' | 'association' | 'process' | 'unknown';
    _class: Ref<Class<Doc>>;
    label?: IntlString;
    name?: string;
    memberOf?: string;
}
export interface AttributeSlotModel extends SlotModel {
    slotKind: 'attribute';
    type: Type<any>;
    enumValues?: string[];
}
export interface Process extends Doc {
    masterTag: Ref<MasterTag | Tag>;
    rank: Rank;
    name: string;
    description: string;
    parallelExecutionForbidden?: boolean;
    showInHeader?: boolean;
    autoStart?: boolean;
    automationOnly?: boolean;
    context: Record<ContextId, ProcessContext>;
    resultType?: Type<any>;
    requiredSlots?: Record<string, SlotModel>;
    bindings?: Record<string, string>;
}
export interface ProcessContext {
    name: string;
    _class: Ref<Class<Doc>>;
    action: StepId;
    index: number;
    producer: Ref<Transition>;
    isResult?: boolean;
    type?: Type<any>;
    value: SelectedExecutionContext;
}
export type ContextId = string & {
    __contextId: true;
};
export interface Trigger extends Doc {
    icon: Asset;
    label: IntlString;
    requiredParams: string[];
    editor?: AnyComponent;
    presenter?: AnyComponent;
    checkFunction?: Resource<CheckFunc>;
    init: boolean;
    auto?: boolean;
}
export interface Transition extends Doc {
    process: Ref<Process>;
    from: Ref<State> | null;
    to: Ref<State>;
    actions: Step<Doc>[];
    trigger: Ref<Trigger>;
    triggerParams: Record<string, any>;
    rank: Rank;
}
export interface ExecutionLog extends Doc {
    execution: Ref<Execution>;
    card: Ref<Card>;
    process: Ref<Process>;
    transition?: Ref<Transition>;
    action: ExecutionLogAction;
}
export declare enum ExecutionLogAction {
    Started = "started",
    Transition = "transition",
    Rollback = "rollback"
}
export type CheckFunc = (client: Client, execution: Execution, params: Record<string, any>, context: Record<string, any>) => Promise<boolean>;
export declare enum ExecutionStatus {
    Active = "active",
    Done = "done",
    Cancelled = "cancelled"
}
export interface Execution extends Doc {
    process: Ref<Process>;
    currentState: Ref<State>;
    card: Ref<Card>;
    rollback: Tx[][];
    error?: ExecutionError[] | null;
    context: ExecutionContext;
    result?: any;
    parentId?: Ref<Execution>;
    status: ExecutionStatus;
}
export type ExecutionContext = Record<ContextId, any> & {
    __contextId: true;
};
export interface ExecutionError {
    error: IntlString;
    props: Record<string, any>;
    intlProps: Record<string, IntlString>;
    transition: Ref<Transition> | undefined;
}
export interface ProcessToDo extends ToDo {
    execution: Ref<Execution>;
    withRollback: boolean;
    results?: UserResult[];
    field?: string;
    askRequired?: boolean;
    group?: string;
    completionMode?: 'any' | 'all';
}
export interface ApproveRequest extends ProcessToDo {
    card: Ref<Card>;
    approved?: boolean;
    reason?: string;
    group: string;
    field?: string;
    actionType?: 'approve' | 'review';
}
export type MethodParams<T extends Doc> = {
    [P in keyof T]?: ObjQueryType<T[P]> | string;
} & DocumentUpdate<T> & Record<string, any>;
export interface State extends Doc {
    process: Ref<Process>;
    title: string;
    rank: Rank;
}
export type StepId = string & {
    __stepId: true;
};
export interface Step<T extends Doc> {
    _id: StepId;
    context: StepContext | null;
    methodId: Ref<Method<T>>;
    params: MethodParams<T>;
    results?: UserResult[];
}
export interface StepContext {
    _id: ContextId;
    _class?: Ref<Class<Doc>>;
}
export interface SelectionRelation {
    association: Ref<Association>;
    direction: 'A' | 'B';
    versions?: 'all' | 'latest' | 'effective';
}
export interface UserResult {
    _id: ContextId;
    name: string;
    key?: string;
    type: Type<any>;
    selectionSpace?: string;
    excludeRelation?: SelectionRelation;
}
export interface ProcessCustomEvent extends Doc {
    eventType: string;
    execution: Ref<Execution>;
    card: Ref<Card>;
}
export interface EventButton extends Doc {
    requireAttachments?: boolean;
    title: string;
    description?: Markup;
    eventType: string;
    user?: ToDo['user'];
    execution: Ref<Execution>;
    card: Ref<Card>;
}
export interface Method<T extends Doc> extends Doc {
    label: IntlString;
    objectClass: Ref<Class<T>>;
    requiredParams: string[];
    description?: IntlString;
    editor?: AnyComponent;
    presenter?: AnyComponent;
    createdContext: CreatedContext | null;
    defaultParams?: MethodParams<T>;
}
export interface CreatedContext {
    _class: Ref<Class<Doc>>;
    nameField?: string;
}
export interface ProcessFunction extends Doc {
    type: 'transform' | 'reduce' | 'context' | 'convert';
    of: Ref<Class<Doc>>;
    to?: Ref<Class<Doc>>;
    editor?: AnyComponent;
    editorProps?: Record<string, unknown>;
    presenter?: AnyComponent;
    category: AttributeCategory | undefined;
    allowMany?: boolean;
    label: IntlString;
}
export interface UpdateCriteriaComponent extends Doc {
    category: AttributeCategory;
    editor: AnyComponent;
    of: Ref<Class<Doc>>;
    props: Record<string, any>;
}
export * from './dslContext';
export * from './errors';
export type * from './types';
export * from './utils';
export { compileProcessYaml, parseProcessImport, validateProcessYaml, ProcessAuthoringError } from './authoring';
export type { AuthoringNativeDocument, ProcessAuthoringResult } from './authoring';
export type { AuthoringDiagnostic, AuthoringValidation } from './authoring-validation';
export { exportProcessYaml, exportProcessYamlDraft } from './authoring-export';
export { exportAuthoringModel, getAuthoringCatalog, getAuthoringProcessIdentities, remapAuthoringReferences, validateAuthoringModelOperations } from './authoring-model';
declare const _default: {
    class: {
        Process: Ref<Class<Process>>;
        Execution: Ref<Class<Execution>>;
        ProcessToDo: Ref<Class<ProcessToDo>>;
        ApproveRequest: Ref<Class<ApproveRequest>>;
        Method: Ref<Class<Method<Doc>>>;
        State: Ref<Class<State>>;
        ProcessFunction: Ref<Class<ProcessFunction>>;
        Transition: Ref<Class<Transition>>;
        Trigger: Ref<Class<Trigger>>;
        ProcessCustomEvent: Ref<Class<ProcessCustomEvent>>;
        ExecutionLog: Ref<Class<ExecutionLog>>;
        UpdateCriteriaComponent: Ref<Class<UpdateCriteriaComponent>>;
        EventButton: Ref<Class<EventButton>>;
    };
    method: {
        RunSubProcess: Ref<Method<Process>>;
        CancelSubProcess: Ref<Method<Process>>;
        CreateAction: Ref<Method<EventButton>>;
        RequestAttachments: Ref<Method<EventButton>>;
        SetContext: Ref<Method<Doc>>;
        UpdateContext: Ref<Method<Doc>>;
        CancellAction: Ref<Method<EventButton>>;
        CreateToDo: Ref<Method<ProcessToDo>>;
        CloseToDo: Ref<Method<ProcessToDo>>;
        UpdateCard: Ref<Method<Card>>;
        CreateCard: Ref<Method<Card>>;
        AddRelation: Ref<Method<Association>>;
        RemoveRelation: Ref<Method<Association>>;
        AddTag: Ref<Method<Tag>>;
        RemoveTag: Ref<Method<Tag>>;
        RequestApproval: Ref<Method<ApproveRequest>>;
        CancelToDo: Ref<Method<ProcessToDo>>;
        LockCard: Ref<Method<Card>>;
        LockSection: Ref<Method<Card>>;
        UnlockCard: Ref<Method<Card>>;
        UnlockSection: Ref<Method<Card>>;
        LockField: Ref<Method<Card>>;
        UnlockField: Ref<Method<Card>>;
        MakeVersionEffective: Ref<Method<Card>>;
        CreateNewVersion: Ref<Method<Card>>;
        DisableVersionCreation: Ref<Method<Card>>;
        EnableVersionCreation: Ref<Method<Card>>;
    };
    trigger: {
        OnCardUpdate: Ref<Trigger>;
        WhenFieldChanges: Ref<Trigger>;
        WhenRequiredFieldsFilled: Ref<Trigger>;
        OnSubProcessesDone: Ref<Trigger>;
        OnSubProcessMatch: Ref<Trigger>;
        OnToDoClose: Ref<Trigger>;
        OnToDoRemove: Ref<Trigger>;
        OnExecutionStart: Ref<Trigger>;
        OnNewVersion: Ref<Trigger>;
        OnVersionEffective: Ref<Trigger>;
        OnVersionIneffective: Ref<Trigger>;
        OnExecutionContinue: Ref<Trigger>;
        OnTime: Ref<Trigger>;
        OnEvent: Ref<Trigger>;
        WhenRelationChanges: Ref<Trigger>;
        OnApproveRequestApproved: Ref<Trigger>;
        OnApproveRequestRejected: Ref<Trigger>;
    };
    triggerCheck: {
        ToDo: Resource<CheckFunc>;
        MatchCheck: Resource<CheckFunc>;
        FieldChangedCheck: Resource<CheckFunc>;
        RequiredFieldsFilledCheck: Resource<CheckFunc>;
        SubProcessesDoneCheck: Resource<CheckFunc>;
        SubProcessMatchCheck: Resource<CheckFunc>;
        Time: Resource<CheckFunc>;
        OnEventCheck: Resource<CheckFunc>;
        RelationChangedCheck: Resource<CheckFunc>;
        ApproveRequestApproved: Resource<CheckFunc>;
        ApproveRequestRejected: Resource<CheckFunc>;
    };
    string: {
        Method: IntlString;
        Execution: IntlString;
        Process: IntlString;
        Step: IntlString;
        Error: IntlString;
        From: IntlString;
        To: IntlString;
        Trigger: IntlString;
        Actions: IntlString;
        ProcessRunned: IntlString;
        ProcessStateChanged: IntlString;
        ProcessFinished: IntlString;
        SyncWithField: IntlString;
        ActionType: IntlString;
        ApproveAction: IntlString;
        ReviewAction: IntlString;
        Review: IntlString;
    };
    error: {
        TagHasSubtags: IntlString;
        MethodNotFound: IntlString;
        InternalServerError: IntlString;
        EmptyRelatedObjectValue: IntlString;
        RelatedObjectNotFound: IntlString;
        RelationNotExists: IntlString;
        EmptyAttributeContextValue: IntlString;
        ObjectNotFound: IntlString;
        AttributeNotExists: IntlString;
        UserRequestedValueNotProvided: IntlString;
        ResultNotProvided: IntlString;
        EmptyFunctionResult: IntlString;
        ContextValueNotProvided: IntlString;
        RequiredParamsNotProvided: IntlString;
        TooDeepTransitionRecursion: IntlString;
        ToDoAlreadyCompleted: IntlString;
        GuestWithoutCardAccess: IntlString;
    };
    icon: {
        Process: Asset;
        Steps: Asset;
        States: Asset;
        ToDo: Asset;
        WhenCardMatches: Asset;
        WhenFieldChanges: Asset;
        WaitSubprocesses: Asset;
        ToDoRemove: Asset;
        Start: Asset;
        Time: Asset;
        OnEvent: Asset;
    };
    function: {
        AllMatchValue: Ref<ProcessFunction>;
        FirstMatchValue: Ref<ProcessFunction>;
        Filter: Ref<ProcessFunction>;
        ArrayLength: Ref<ProcessFunction>;
        RelationCount: Ref<ProcessFunction>;
        FirstValue: Ref<ProcessFunction>;
        LastValue: Ref<ProcessFunction>;
        Random: Ref<ProcessFunction>;
        UpperCase: Ref<ProcessFunction>;
        LowerCase: Ref<ProcessFunction>;
        Trim: Ref<ProcessFunction>;
        Prepend: Ref<ProcessFunction>;
        Append: Ref<ProcessFunction>;
        PrependMarkup: Ref<ProcessFunction>;
        AppendMarkup: Ref<ProcessFunction>;
        Replace: Ref<ProcessFunction>;
        ReplaceAll: Ref<ProcessFunction>;
        Split: Ref<ProcessFunction>;
        Cut: Ref<ProcessFunction>;
        Add: Ref<ProcessFunction>;
        Subtract: Ref<ProcessFunction>;
        Multiply: Ref<ProcessFunction>;
        Divide: Ref<ProcessFunction>;
        Modulo: Ref<ProcessFunction>;
        Power: Ref<ProcessFunction>;
        Sqrt: Ref<ProcessFunction>;
        Round: Ref<ProcessFunction>;
        Absolute: Ref<ProcessFunction>;
        Ceil: Ref<ProcessFunction>;
        Floor: Ref<ProcessFunction>;
        Min: Ref<ProcessFunction>;
        Max: Ref<ProcessFunction>;
        Offset: Ref<ProcessFunction>;
        FirstWorkingDayAfter: Ref<ProcessFunction>;
        RoleContext: Ref<ProcessFunction>;
        All: Ref<ProcessFunction>;
        Insert: Ref<ProcessFunction>;
        Remove: Ref<ProcessFunction>;
        RemoveFirst: Ref<ProcessFunction>;
        RemoveLast: Ref<ProcessFunction>;
        CurrentEmployee: Ref<ProcessFunction>;
        CurrentUser: Ref<ProcessFunction>;
        ExecutionStarted: Ref<ProcessFunction>;
        ExecutionEmployeeInitiator: Ref<ProcessFunction>;
        ExecutionInitiator: Ref<ProcessFunction>;
        EmptyValue: Ref<ProcessFunction>;
        EmptyArray: Ref<ProcessFunction>;
        CurrentDate: Ref<ProcessFunction>;
        StringFromIdentifier: Ref<ProcessFunction>;
        StringFromNumber: Ref<ProcessFunction>;
        StringFromDate: Ref<ProcessFunction>;
        StringFromMarkup: Ref<ProcessFunction>;
        MarkupFromString: Ref<ProcessFunction>;
        StringFromBoolean: Ref<ProcessFunction>;
        NumberFromDate: Ref<ProcessFunction>;
        DateFromNumber: Ref<ProcessFunction>;
        NumberFromString: Ref<ProcessFunction>;
        DateFromString: Ref<ProcessFunction>;
        YearFromDate: Ref<ProcessFunction>;
        MonthFromDate: Ref<ProcessFunction>;
        DayFromDate: Ref<ProcessFunction>;
        StringFromEnum: Ref<ProcessFunction>;
        EnumFromString: Ref<ProcessFunction>;
        DateDifference: Ref<ProcessFunction>;
        TableFromRelation: Ref<ProcessFunction>;
        ExportProcess: Resource<ExportFunc>;
        CheckProcessSectionVisibility: Resource<(doc: Card) => Promise<boolean>>;
    };
};
export default _default;
//# sourceMappingURL=index.d.ts.map