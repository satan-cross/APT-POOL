import type { QueryKey, UseMutationOptions, UseMutationResult, UseQueryOptions, UseQueryResult } from '@tanstack/react-query';
import type { CommandCenterSettings, CommandCenterSettingsInput, CommandCenterStatus, DemoInput, DemoResult, DnsMigrationInput, ErrorResponse, ExploitDetectionInput, ExploitDetectionResult, HealthStatus, TaskOrderCatalog, TaskOrderQueueInput, TaskOrderQueueResult, TaskOrderQuote, TaskOrderQuoteInput } from './api.schemas';
import { customFetch } from '../custom-fetch';
import type { ErrorType, BodyType } from '../custom-fetch';
type AwaitedInput<T> = PromiseLike<T> | T;
type Awaited<O> = O extends AwaitedInput<infer T> ? T : never;
type SecondParameter<T extends (...args: never) => unknown> = Parameters<T>[1];
export declare const getHealthCheckUrl: () => string;
/**
 * Returns server health status
 * @summary Health check
 */
export declare const healthCheck: (options?: Parameters<typeof customFetch>[1]) => Promise<HealthStatus>;
export declare const getHealthCheckQueryKey: () => readonly ["/api/healthz"];
export declare const getHealthCheckQueryOptions: <TData = Awaited<ReturnType<typeof healthCheck>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData> & {
    queryKey: QueryKey;
};
export type HealthCheckQueryResult = NonNullable<Awaited<ReturnType<typeof healthCheck>>>;
export type HealthCheckQueryError = ErrorType<unknown>;
/**
 * @summary Health check
 */
export declare function useHealthCheck<TData = Awaited<ReturnType<typeof healthCheck>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetCommandCenterStatusUrl: () => string;
/**
 * Returns the current in-memory coordinator snapshot for the defensive workload dashboard.
 * @summary Read live command center telemetry
 */
export declare const getCommandCenterStatus: (options?: Parameters<typeof customFetch>[1]) => Promise<CommandCenterStatus>;
export declare const getGetCommandCenterStatusQueryKey: () => readonly ["/api/command-center/status"];
export declare const getGetCommandCenterStatusQueryOptions: <TData = Awaited<ReturnType<typeof getCommandCenterStatus>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getCommandCenterStatus>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getCommandCenterStatus>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetCommandCenterStatusQueryResult = NonNullable<Awaited<ReturnType<typeof getCommandCenterStatus>>>;
export type GetCommandCenterStatusQueryError = ErrorType<unknown>;
/**
 * @summary Read live command center telemetry
 */
export declare function useGetCommandCenterStatus<TData = Awaited<ReturnType<typeof getCommandCenterStatus>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getCommandCenterStatus>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetTaskOrderCatalogUrl: () => string;
/**
 * Returns archive-inspired defensive lab tasks mapped to bounded local executors. Payment, deposits, external targets, and credential recovery are not supported.
 * @summary Read safe task-order preview catalog
 */
export declare const getTaskOrderCatalog: (options?: Parameters<typeof customFetch>[1]) => Promise<TaskOrderCatalog>;
export declare const getGetTaskOrderCatalogQueryKey: () => readonly ["/api/command-center/task-orders"];
export declare const getGetTaskOrderCatalogQueryOptions: <TData = Awaited<ReturnType<typeof getTaskOrderCatalog>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getTaskOrderCatalog>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getTaskOrderCatalog>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetTaskOrderCatalogQueryResult = NonNullable<Awaited<ReturnType<typeof getTaskOrderCatalog>>>;
export type GetTaskOrderCatalogQueryError = ErrorType<unknown>;
/**
 * @summary Read safe task-order preview catalog
 */
export declare function useGetTaskOrderCatalog<TData = Awaited<ReturnType<typeof getTaskOrderCatalog>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getTaskOrderCatalog>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getQuoteTaskOrderUrl: () => string;
/**
 * Estimates synthetic credits and completion time from total items, projected solved percentage, and measured hash rate. It never creates an order or dispatches work.
 * @summary Calculate a preview-only synthetic task-order quote
 */
export declare const quoteTaskOrder: (taskOrderQuoteInput: TaskOrderQuoteInput, options?: Parameters<typeof customFetch>[1]) => Promise<TaskOrderQuote>;
export declare const getQuoteTaskOrderMutationKey: () => readonly ["quoteTaskOrder"];
export declare const getQuoteTaskOrderMutationOptions: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof quoteTaskOrder>>, TError, QuoteTaskOrderMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof quoteTaskOrder>>, TError, QuoteTaskOrderMutationVariables, TContext>;
export type QuoteTaskOrderMutationResult = NonNullable<Awaited<ReturnType<typeof quoteTaskOrder>>>;
export type QuoteTaskOrderMutationBody = BodyType<TaskOrderQuoteInput>;
export type QuoteTaskOrderMutationError = ErrorType<ErrorResponse>;
export type QuoteTaskOrderMutationVariables = {
    data: BodyType<TaskOrderQuoteInput>;
};
/**
* @summary Calculate a preview-only synthetic task-order quote
*/
export declare const useQuoteTaskOrder: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof quoteTaskOrder>>, TError, QuoteTaskOrderMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof quoteTaskOrder>>, TError, QuoteTaskOrderMutationVariables, TContext>;
export declare const getQueueTaskOrderUrl: () => string;
/**
 * Pins an available safe task to the loopback-only local miner pool. Current local workers receive a fresh job and future local workers receive the same selected task until another task is queued.
 * @summary Queue a safe task for local miners
 */
export declare const queueTaskOrder: (taskOrderQueueInput: TaskOrderQueueInput, options?: Parameters<typeof customFetch>[1]) => Promise<TaskOrderQueueResult>;
export declare const getQueueTaskOrderMutationKey: () => readonly ["queueTaskOrder"];
export declare const getQueueTaskOrderMutationOptions: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof queueTaskOrder>>, TError, QueueTaskOrderMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof queueTaskOrder>>, TError, QueueTaskOrderMutationVariables, TContext>;
export type QueueTaskOrderMutationResult = NonNullable<Awaited<ReturnType<typeof queueTaskOrder>>>;
export type QueueTaskOrderMutationBody = BodyType<TaskOrderQueueInput>;
export type QueueTaskOrderMutationError = ErrorType<ErrorResponse>;
export type QueueTaskOrderMutationVariables = {
    data: BodyType<TaskOrderQueueInput>;
};
/**
* @summary Queue a safe task for local miners
*/
export declare const useQueueTaskOrder: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof queueTaskOrder>>, TError, QueueTaskOrderMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof queueTaskOrder>>, TError, QueueTaskOrderMutationVariables, TContext>;
export declare const getGetCommandCenterSettingsUrl: () => string;
/**
 * @summary Read persisted command center settings
 */
export declare const getCommandCenterSettings: (options?: Parameters<typeof customFetch>[1]) => Promise<CommandCenterSettings>;
export declare const getGetCommandCenterSettingsQueryKey: () => readonly ["/api/command-center/settings"];
export declare const getGetCommandCenterSettingsQueryOptions: <TData = Awaited<ReturnType<typeof getCommandCenterSettings>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getCommandCenterSettings>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getCommandCenterSettings>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetCommandCenterSettingsQueryResult = NonNullable<Awaited<ReturnType<typeof getCommandCenterSettings>>>;
export type GetCommandCenterSettingsQueryError = ErrorType<unknown>;
/**
 * @summary Read persisted command center settings
 */
export declare function useGetCommandCenterSettings<TData = Awaited<ReturnType<typeof getCommandCenterSettings>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getCommandCenterSettings>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getSaveCommandCenterSettingsUrl: () => string;
/**
 * @summary Persist command center difficulty, miner count, and GPU backend
 */
export declare const saveCommandCenterSettings: (commandCenterSettingsInput: CommandCenterSettingsInput, options?: Parameters<typeof customFetch>[1]) => Promise<CommandCenterSettings>;
export declare const getSaveCommandCenterSettingsMutationKey: () => readonly ["saveCommandCenterSettings"];
export declare const getSaveCommandCenterSettingsMutationOptions: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof saveCommandCenterSettings>>, TError, SaveCommandCenterSettingsMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof saveCommandCenterSettings>>, TError, SaveCommandCenterSettingsMutationVariables, TContext>;
export type SaveCommandCenterSettingsMutationResult = NonNullable<Awaited<ReturnType<typeof saveCommandCenterSettings>>>;
export type SaveCommandCenterSettingsMutationBody = BodyType<CommandCenterSettingsInput>;
export type SaveCommandCenterSettingsMutationError = ErrorType<ErrorResponse>;
export type SaveCommandCenterSettingsMutationVariables = {
    data: BodyType<CommandCenterSettingsInput>;
};
/**
* @summary Persist command center difficulty, miner count, and GPU backend
*/
export declare const useSaveCommandCenterSettings: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof saveCommandCenterSettings>>, TError, SaveCommandCenterSettingsMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof saveCommandCenterSettings>>, TError, SaveCommandCenterSettingsMutationVariables, TContext>;
export declare const getRunCommandCenterDemoUrl: () => string;
/**
 * @summary Run one bounded defensive workload demo
 */
export declare const runCommandCenterDemo: (demoInput: DemoInput, options?: Parameters<typeof customFetch>[1]) => Promise<DemoResult>;
export declare const getRunCommandCenterDemoMutationKey: () => readonly ["runCommandCenterDemo"];
export declare const getRunCommandCenterDemoMutationOptions: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof runCommandCenterDemo>>, TError, RunCommandCenterDemoMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof runCommandCenterDemo>>, TError, RunCommandCenterDemoMutationVariables, TContext>;
export type RunCommandCenterDemoMutationResult = NonNullable<Awaited<ReturnType<typeof runCommandCenterDemo>>>;
export type RunCommandCenterDemoMutationBody = BodyType<DemoInput>;
export type RunCommandCenterDemoMutationError = ErrorType<ErrorResponse>;
export type RunCommandCenterDemoMutationVariables = {
    data: BodyType<DemoInput>;
};
/**
* @summary Run one bounded defensive workload demo
*/
export declare const useRunCommandCenterDemo: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof runCommandCenterDemo>>, TError, RunCommandCenterDemoMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof runCommandCenterDemo>>, TError, RunCommandCenterDemoMutationVariables, TContext>;
export declare const getMigrateCommandCenterDnsUrl: () => string;
/**
 * @summary Migrate the controlled lab DNS record and query it
 */
export declare const migrateCommandCenterDns: (dnsMigrationInput: DnsMigrationInput, options?: Parameters<typeof customFetch>[1]) => Promise<DemoResult>;
export declare const getMigrateCommandCenterDnsMutationKey: () => readonly ["migrateCommandCenterDns"];
export declare const getMigrateCommandCenterDnsMutationOptions: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof migrateCommandCenterDns>>, TError, MigrateCommandCenterDnsMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof migrateCommandCenterDns>>, TError, MigrateCommandCenterDnsMutationVariables, TContext>;
export type MigrateCommandCenterDnsMutationResult = NonNullable<Awaited<ReturnType<typeof migrateCommandCenterDns>>>;
export type MigrateCommandCenterDnsMutationBody = BodyType<DnsMigrationInput>;
export type MigrateCommandCenterDnsMutationError = ErrorType<ErrorResponse>;
export type MigrateCommandCenterDnsMutationVariables = {
    data: BodyType<DnsMigrationInput>;
};
/**
* @summary Migrate the controlled lab DNS record and query it
*/
export declare const useMigrateCommandCenterDns: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof migrateCommandCenterDns>>, TError, MigrateCommandCenterDnsMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof migrateCommandCenterDns>>, TError, MigrateCommandCenterDnsMutationVariables, TContext>;
export declare const getRunCommandCenterExploitDetectionUrl: () => string;
/**
 * Performs static indicator matching against a user-supplied HTML, JavaScript, or header snapshot. The target URL is treated as a label; the server does not contact it.
 * @summary Analyze a site snapshot without executing exploit content
 */
export declare const runCommandCenterExploitDetection: (exploitDetectionInput: ExploitDetectionInput, options?: Parameters<typeof customFetch>[1]) => Promise<ExploitDetectionResult>;
export declare const getRunCommandCenterExploitDetectionMutationKey: () => readonly ["runCommandCenterExploitDetection"];
export declare const getRunCommandCenterExploitDetectionMutationOptions: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof runCommandCenterExploitDetection>>, TError, RunCommandCenterExploitDetectionMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof runCommandCenterExploitDetection>>, TError, RunCommandCenterExploitDetectionMutationVariables, TContext>;
export type RunCommandCenterExploitDetectionMutationResult = NonNullable<Awaited<ReturnType<typeof runCommandCenterExploitDetection>>>;
export type RunCommandCenterExploitDetectionMutationBody = BodyType<ExploitDetectionInput>;
export type RunCommandCenterExploitDetectionMutationError = ErrorType<ErrorResponse>;
export type RunCommandCenterExploitDetectionMutationVariables = {
    data: BodyType<ExploitDetectionInput>;
};
/**
* @summary Analyze a site snapshot without executing exploit content
*/
export declare const useRunCommandCenterExploitDetection: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof runCommandCenterExploitDetection>>, TError, RunCommandCenterExploitDetectionMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof runCommandCenterExploitDetection>>, TError, RunCommandCenterExploitDetectionMutationVariables, TContext>;
export {};
//# sourceMappingURL=api.d.ts.map