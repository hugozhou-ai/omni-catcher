import { createServiceIdentifier } from "@omni-catcher/shared/platform";
import type { Item, ItemMetaUpdate } from "@omni-catcher/shared";
import { Store } from "../platform/store.js";
import type { IApiService } from "./apiService.js";

export interface ILibraryService {
  readonly items: Store<Item[]>;
  refresh(type?: string): Promise<void>;
  readItem(id: string): Promise<{ item: Item; markdown: string }>;
  updateItemMeta(id: string, update: ItemMetaUpdate): Promise<Item>;
  updateTodoTask(id: string, taskIndex: number, completed: boolean): Promise<{ item: Item; markdown: string }>;
  deleteItem(id: string): Promise<Item>;
}

export const ILibraryService = createServiceIdentifier<ILibraryService>("libraryService");

export class LibraryService implements ILibraryService {
  readonly items = new Store<Item[]>([]);

  constructor(private readonly api: IApiService) {}

  async refresh(type?: string): Promise<void> {
    const query = type && type !== "all" ? `?type=${encodeURIComponent(type)}` : "";
    const data = await this.api.get<{ items: Item[] }>(`/api/items${query}`);
    this.items.set(data.items || []);
  }

  readItem(id: string): Promise<{ item: Item; markdown: string }> {
    return this.api.get<{ item: Item; markdown: string }>(`/api/items/${id}`);
  }

  async updateItemMeta(id: string, update: ItemMetaUpdate): Promise<Item> {
    const data = await this.api.patch<{ item: Item }>(`/api/items/${id}`, update);
    const current = this.items.get();
    this.items.set(current.map((item) => (item.id === id ? data.item : item)));
    return data.item;
  }

  async updateTodoTask(id: string, taskIndex: number, completed: boolean): Promise<{ item: Item; markdown: string }> {
    return this.api.patch<{ item: Item; markdown: string }>(`/api/items/${id}/todo-task`, {
      taskIndex,
      completed,
    });
  }

  async deleteItem(id: string): Promise<Item> {
    const data = await this.api.delete<{ item: Item }>(`/api/items/${id}`);
    const current = this.items.get();
    this.items.set(current.filter((item) => item.id !== id));
    return data.item;
  }
}
