"use strong"
import { ArrowLeftIcon, ChevronRightIcon, FolderIcon, SearchIcon } from "@octanejs/lucide"
import { useNavigate } from "@octanejs/tanstack-router"
import { useQuery } from "@octanejs/zero"
import { queries } from "@valterra/contract"
import { FileId, FileLocation, sameFileLocation } from "@valterra/core"
import { Button } from "@valterra/ui/components/ui/button"
import { Input } from "@valterra/ui/components/ui/input"
import { Label } from "@valterra/ui/components/ui/label"
import { useAppForm } from "@valterra/ui/form/app-form"
import { useEffect, useLinkedState } from "octane"

import { apiRequestMessage } from "../../api/client.ts"
import { filesApi } from "../files/api.ts"
import { FilesUpload } from "../files/files-upload.tsrx"
import { type FileRow } from "../files/model.ts"
import { DocumentFile } from "./document-file.tsrx"
import { useDocumentLocations } from "./locations.tsrx"
import {
	type DocumentsSearch,
	documentLocation,
	folderContents,
	folderPath,
	locationSearch,
} from "./model.ts"
import { RecordFilesPicker } from "./record-files-picker.tsrx"

type SearchResult = Awaited<ReturnType<ReturnType<typeof filesApi>["search"]>>

export function DocumentsHome(props: {
	readonly wrkId: string
	readonly search: DocumentsSearch
}) @{
	const navigate = useNavigate()
	const { identity, locations } = useDocumentLocations()
	const location = documentLocation(props.search, identity.id)
	const path = folderPath(props.search.folder ?? "")
	const query = props.search.q?.trim() ?? ""
	const api = filesApi(props.wrkId)
	const held = locations.some((option) => sameFileLocation(option.location, location))
	const locationLabel =
		locations.find((option) => sameFileLocation(option.location, location))?.label ??
		FileLocation.match(location, {
			Record: () => "Record files",
			Workspace: () => "Workspace files",
			Private: () => "Shared private files",
			Team: () => "Shared team files",
		})
	const [rows, result] = useQuery(queries.filesAtLocation({ location }))
	const [categories] = useQuery(queries.fileCategories())
	const [tables] = useQuery(queries.workspaceCatalog())
	const contents = folderContents(rows, path)
	const [uploadPath, setUploadPath] = useLinkedState(path, (value) => value)
	const searchKey = `${props.wrkId}:${query}`
	const [found, setFound] = useLinkedState(searchKey, (): SearchResult | null => null)
	const [error, setError] = useLinkedState(searchKey, () => "")
	const [deleted, setDeleted] = useLinkedState(props.wrkId, (): FileRow | null => null)
	const workspaceId = props.wrkId
	useEffect(() => {
		if (query.length < 2) return
		const controller = new AbortController()
		void filesApi(workspaceId)
			.search({ query, limit: 50 }, controller.signal)
			.then(
				(value) => {
					if (!controller.signal.aborted) setFound(value)
				},
				(cause: unknown) => {
					if (!controller.signal.aborted)
						setError(apiRequestMessage(cause, "Could not search documents."))
				},
			)
		return () => controller.abort()
	})
	const go = (search: DocumentsSearch) => {
		void navigate({ to: "/wrk{$wrkId}/documents", params: { wrkId: props.wrkId }, search })
	}
	const openFolder = (folder: string) => go({ ...locationSearch(location), folder })
	const targets = locations.map((option) => ({
		key: option.key,
		label: option.label,
		detail: "Location",
		location: option.location,
	}))
	const searchForm = useAppForm({
		defaultValues: { query },
		onSubmit: ({ value }) => {
			if (value.query.trim().length >= 2) go({ ...locationSearch(location), q: value.query.trim() })
		},
	})

	const restore = () => {
		if (deleted === null) return
		void api.restore(FileId.make(deleted.id)).then(
			() => setDeleted(null),
			(cause: unknown) => setError(apiRequestMessage(cause, "Could not restore this file.")),
		)
	}
	<section
		class="@container flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-6 sm:px-8"
		aria-label="Documents"
	>
		<div class="mx-auto w-full max-w-6xl">
			<header class="mb-6">
				<h1 class="text-2xl font-semibold">Documents</h1>
				<p class="mt-1 text-sm text-muted-foreground">
					Browse your workspace, private, and record files.
				</p>
			</header>
			<searchForm.AppForm>
				<searchForm.Form className="mb-6 flex max-w-xl items-center gap-2" role="search">
					<searchForm.AppField name="query">
						{(field) => (
							<field.TextField
								aria-label="Search documents"
								placeholder="Search files across all locations…"
								maxLength={200}
								className="flex-1"
							/>
						)}
					</searchForm.AppField>
					<Button type="submit" variant="outline" aria-label="Search">
						<SearchIcon className="size-4" />
					</Button>
				</searchForm.Form>
			</searchForm.AppForm>

			@if (deleted !== null) {
				<div
					role="status"
					class="mb-4 flex items-center gap-3 rounded-md border bg-muted/30 p-3 text-sm"
				>
					<span>Deleted {deleted.name}.</span>
					<Button variant="outline" size="sm" onClick={restore}>
						Restore
					</Button>
				</div>
			}
			@if (error !== "") {
				<p role="alert" class="mb-4 text-sm text-destructive">
					{error}
				</p>
			}
			@if (props.search.browse === "records" && query.length < 2) {
				<RecordFilesPicker
					workspaceId={props.wrkId}
					tables={tables}
					onSelect={(recordId) => go({ recordId })}
				/>
			} @else if (query.length >= 2) {
				<>
					<div class="mb-4 flex items-center gap-3">
						<Button variant="ghost" size="sm" onClick={() => go(locationSearch(location))}>
							<ArrowLeftIcon className="size-4" />
							Back to files
						</Button>
						<h2 class="text-sm font-medium">Results for “{query}”</h2>
					</div>
					@if (found === null && error === "") {
						<p role="status" class="text-sm text-muted-foreground">
							Searching…
						</p>
					}
					@if (found !== null) {
						<>
							@if (found.files.length === 0) {
								<p class="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
									No files match this search.
								</p>
							}
							<ul
								class="overflow-hidden rounded-lg border empty:hidden"
								aria-label="Search results"
							>
								@for (const file of found.files; key file.fileId) {
									<li class="flex min-w-0 items-center gap-3 border-b p-3 last:border-b-0">
										<FolderIcon className="size-4 shrink-0 text-muted-foreground" />
										<div class="min-w-0 flex-1">
											<p class="truncate text-sm font-medium">{file.name}</p>
											<p class="truncate text-xs text-muted-foreground">
												{locations.find((option) =>
													sameFileLocation(option.location, file.location),
												)?.label ??
													FileLocation.match(file.location, {
														Record: () => "Record files",
														Workspace: () => "Workspace files",
														Private: () => "Shared private files",
														Team: () => "Shared team files",
													})}
												{file.folderPath === "" ? "" : ` / ${file.folderPath}`}
											</p>
										</div>
										<Button
											variant="outline"
											size="sm"
											onClick={() =>
												go({
													...locationSearch(file.location),
													folder: file.folderPath,
												})
											}
										>
											Open folder
										</Button>
									</li>
								}
							</ul>
							@if (found.files.length === 50) {
								<p class="mt-3 text-xs text-muted-foreground">
									Showing the first 50 matches. Refine your search to find more.
								</p>
							}
						</>
					}
				</>
			} @else {
				<>
					<nav
						aria-label="Folder breadcrumbs"
						class="mb-4 flex flex-wrap items-center gap-1 text-sm"
					>
						<Button variant="ghost" size="sm" onClick={() => openFolder("")}>
							{locationLabel}
						</Button>
						@for (const segment of path
								.split("/")
								.filter(Boolean)
								.map((name, index, parts) => ({
									name,
									path: parts.slice(0, index + 1).join("/"),
								})); key segment.path) {
							<>
								<ChevronRightIcon className="size-3 text-muted-foreground" />
								<Button
									variant="ghost"
									size="sm"
									onClick={() => openFolder(segment.path)}
								>
									{segment.name}
								</Button>
							</>
						}
					</nav>
					@if (held || FileLocation.guards.Record(location)) {
						<div class="mb-5 rounded-lg border bg-muted/20 p-3">
							<Label className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
								Upload to folder
								<Input
									className="h-7 max-w-xs"
									aria-label="Upload folder path"
									placeholder="Root, or e.g. Closing/Reports"
									value={uploadPath}
									maxLength={1024}
									onInput={(event: Event) => {
										if (event.target instanceof HTMLInputElement)
											setUploadPath(event.target.value)
									}}
								/>
							</Label>
							<FilesUpload
								workspaceId={props.wrkId}
								location={location}
								folderPath={folderPath(uploadPath)}
								title={`Upload to ${locationLabel}`}
							/>
						</div>
					}
					@if (result.type === "error") {
						<div class="flex items-center gap-3">
							<p role="alert" class="text-sm text-destructive">
								Could not load files.
							</p>
							<Button variant="outline" size="sm" onClick={result.retry}>
								Retry
							</Button>
						</div>
					}
					@else if (result.type !== "complete" && rows.length === 0) {
						<p role="status" class="text-sm text-muted-foreground">
							Loading files…
						</p>
					}
					@else {
						<>
							@if (
								contents.folders.length === 0 &&
								contents.files.length === 0
							) {
								<div class="rounded-lg border border-dashed py-12 text-center">
									<FolderIcon className="mx-auto mb-3 size-8 text-muted-foreground" />
									<h2 class="text-sm font-medium">This folder is empty</h2>
									<p class="mt-1 text-sm text-muted-foreground">
										Upload files here, or choose another location.
									</p>
								</div>
							}
							<ul
								aria-label="Folders"
								class="mb-3 overflow-hidden rounded-lg border empty:hidden"
							>
								@for (const name of contents.folders; key name) {
									<li>
										<Button
											variant="ghost"
											className="flex w-full items-center gap-3 border-b px-3 py-3 text-left text-sm last:border-b-0 hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring"
											onClick={() =>
												openFolder(path === "" ? name : `${path}/${name}`)
											}
										>
											<FolderIcon className="size-4 text-muted-foreground" />
											<span class="min-w-0 flex-1 truncate">{name}</span>
											<ChevronRightIcon className="size-4 text-muted-foreground" />
										</Button>
									</li>
								}
							</ul>
							<ul
								aria-label="Files in this folder"
								class="overflow-hidden rounded-lg border empty:hidden"
							>
								@for (const row of contents.files; key row.id) {
									<DocumentFile
										workspaceId={props.wrkId}
										row={row}
										location={location}
										locationLabel={locationLabel}
										categories={categories}
										targets={targets}
										tables={tables}
										canEdit={held}
										onDeleted={setDeleted}
									/>
								}
							</ul>
						</>
					}
				</>
			}
		</div>
	</section>
}
