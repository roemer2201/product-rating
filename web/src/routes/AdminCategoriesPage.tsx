import { useState, type FormEvent } from 'react';
import {
  CATEGORY_NAME_MAX_LENGTH,
  categoryNameSchema,
  type Category,
} from '@product-rating/shared';
import { EmptyState, ErrorNotice, SkeletonList } from '@/components/Feedback';
import { Field } from '@/components/Field';
import { errorMessage } from '@/lib/api';
import {
  useCategories,
  useCreateCategory,
  useDeleteCategory,
  useUpdateCategory,
} from '@/lib/queries';
import { strings } from '@/lib/strings';

/**
 * The category list, as the administrators keep it.
 *
 * Every product form picks from here. An entry marked as frequent stands there
 * as a checkbox, always in view; the others wait in a dropdown. The mark is a
 * checkbox on the row as well and saves on the tap - there is nothing else to
 * fill in, so a second button would only be a second step.
 *
 * Renaming changes the name on every product at once: products refer to the
 * entry, not to its spelling. Deleting takes the category off every product
 * carrying it, which is why it asks a second time and says how many.
 */
export function AdminCategoriesPage() {
  const categories = useCategories();
  const create = useCreateCategory();
  const update = useUpdateCategory();
  const remove = useDeleteCategory();

  const [name, setName] = useState('');
  const [frequent, setFrequent] = useState(false);
  /** The entry whose name is being edited, and the name typed for it. */
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  /** The entry whose deletion is waiting for a second tap. */
  const [deleting, setDeleting] = useState<string | null>(null);
  /** What the last deletion did, for the notice above the list. */
  const [deleted, setDeleted] = useState<{ name: string; count: number } | null>(null);

  const onCreate = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const parsed = categoryNameSchema.safeParse(name);
    if (!parsed.success) return;

    create.mutate(
      { name: parsed.data, frequent },
      {
        onSuccess: () => {
          setName('');
          setFrequent(false);
        },
      },
    );
  };

  const startRename = (entry: Category): void => {
    setRenaming(renaming === entry.id ? null : entry.id);
    setNewName(entry.name);
    update.reset();
  };

  const submitRename = (entry: Category): void => {
    const parsed = categoryNameSchema.safeParse(newName);
    if (!parsed.success) return;

    update.mutate(
      { id: entry.id, input: { name: parsed.data } },
      {
        onSuccess: () => {
          setRenaming(null);
        },
      },
    );
  };

  const onDelete = (entry: Category): void => {
    if (deleting !== entry.id) {
      setDeleting(entry.id);
      return;
    }

    remove.mutate(entry.id, {
      onSuccess: (count) => {
        setDeleted({ name: entry.name, count });
      },
      onSettled: () => {
        setDeleting(null);
      },
    });
  };

  return (
    <section>
      <h1 className="page__title">{strings.admin.categoriesTitle}</h1>
      <p className="page__intro">{strings.admin.categoriesIntro}</p>

      <form className="form" onSubmit={onCreate} noValidate>
        {create.error !== null && <ErrorNotice message={errorMessage(create.error)} />}

        <Field
          label={strings.admin.categoryNew}
          name="name"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
          maxLength={CATEGORY_NAME_MAX_LENGTH}
          autoComplete="off"
          required
        />

        <label className="checkbox">
          <input
            type="checkbox"
            checked={frequent}
            onChange={(event) => {
              setFrequent(event.target.checked);
            }}
          />
          {strings.admin.categoryFrequent}
        </label>

        <div className="form__actions">
          <button
            type="submit"
            className="button button--primary"
            disabled={create.isPending || name.trim() === ''}
          >
            {create.isPending ? strings.admin.categoryCreating : strings.admin.categoryCreate}
          </button>
        </div>
      </form>

      <section className="section">
        {update.error !== null && renaming === null && (
          <ErrorNotice message={errorMessage(update.error)} />
        )}
        {remove.error !== null && <ErrorNotice message={errorMessage(remove.error)} />}
        {deleted !== null && (
          <p className="notice" role="status">
            {strings.admin.categoryDeleted(deleted.name, deleted.count)}
          </p>
        )}

        {categories.isPending ? (
          <SkeletonList rows={3} />
        ) : categories.error !== null ? (
          <ErrorNotice
            message={errorMessage(categories.error)}
            onRetry={() => {
              void categories.refetch();
            }}
          />
        ) : categories.data.length === 0 ? (
          <EmptyState text={strings.admin.categoriesEmpty} />
        ) : (
          <ul className="admin-list">
            {categories.data.map((entry) => (
              <li className="admin-row" key={entry.id}>
                <div className="admin-row__body">
                  <span className="admin-row__name">{entry.name}</span>
                  <span className="admin-row__meta">
                    {strings.admin.categoryProducts(entry.productCount)}
                  </span>
                </div>

                <div className="admin-row__actions">
                  <label className="checkbox admin-row__toggle">
                    <input
                      type="checkbox"
                      checked={entry.frequent}
                      onChange={(event) => {
                        update.mutate({ id: entry.id, input: { frequent: event.target.checked } });
                      }}
                      disabled={update.isPending}
                      aria-label={strings.admin.categoryFrequentFor(entry.name)}
                    />
                    {strings.admin.categoryFrequent}
                  </label>
                  <button
                    type="button"
                    className="button button--quiet"
                    onClick={() => {
                      startRename(entry);
                    }}
                    aria-expanded={renaming === entry.id}
                    aria-label={strings.admin.categoryRenameFor(entry.name)}
                  >
                    {strings.admin.categoryRename}
                  </button>
                  <button
                    type="button"
                    className="button button--quiet button--danger"
                    onClick={() => {
                      onDelete(entry);
                    }}
                    disabled={remove.isPending}
                    aria-label={
                      deleting === entry.id
                        ? undefined
                        : strings.admin.categoryDeleteFor(entry.name)
                    }
                  >
                    {deleting === entry.id
                      ? strings.admin.categoryDeleteConfirm(entry.productCount)
                      : strings.admin.categoryDelete}
                  </button>
                </div>

                {renaming === entry.id && (
                  <form
                    className="admin-row__form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      submitRename(entry);
                    }}
                    noValidate
                  >
                    {update.error !== null && <ErrorNotice message={errorMessage(update.error)} />}

                    <Field
                      label={strings.admin.categoryName}
                      name="rename"
                      value={newName}
                      onChange={(event) => {
                        setNewName(event.target.value);
                      }}
                      maxLength={CATEGORY_NAME_MAX_LENGTH}
                      autoComplete="off"
                      required
                    />

                    <div className="form__actions">
                      <button
                        type="submit"
                        className="button button--primary"
                        disabled={update.isPending || newName.trim() === ''}
                      >
                        {update.isPending
                          ? strings.common.saving
                          : strings.admin.categoryRenameSubmit}
                      </button>
                      <button
                        type="button"
                        className="button"
                        onClick={() => {
                          setRenaming(null);
                        }}
                        disabled={update.isPending}
                      >
                        {strings.common.cancel}
                      </button>
                    </div>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
