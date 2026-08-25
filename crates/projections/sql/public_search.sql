WITH search_query AS NOT MATERIALIZED (
    SELECT websearch_to_tsquery('english'::regconfig, $1) AS value
), ranked AS (
    SELECT document.document_type,
           document.surface_id::text || '-' || document.source_seq::text AS document_key,
           surface.title,
           document.href,
           document.updated_seq,
           document.published_at,
           ROUND(ts_rank_cd(document.search_vector, search_query.value)::numeric * 1000000)::BIGINT AS rank,
           document.title_text,
           document.body
    FROM public_search_document AS document
    JOIN publication_surface AS surface ON surface.surface_id = document.surface_id
    CROSS JOIN search_query
    WHERE document.search_vector @@ search_query.value
      AND document.visible AND surface.visible
      AND ($2 = 'all' OR surface.search_group = $2)
      AND NOT EXISTS (
          SELECT 1 FROM profile_mute AS mute
          WHERE $3::uuid IS NOT NULL
            AND mute.principal_id = $3
            AND mute.active
            AND mute.target_profile_id = document.author_profile_id
      )
), limited AS MATERIALIZED (
    SELECT document_type, document_key, title, href, updated_seq, published_at, rank,
           title_text, body
    FROM ranked
    WHERE $4::bigint IS NULL
       OR rank < $4
       OR (rank = $4 AND updated_seq < $5)
       OR (rank = $4 AND updated_seq = $5 AND document_type > $6)
       OR (rank = $4 AND updated_seq = $5 AND document_type = $6 AND document_key > $7)
    ORDER BY rank DESC, updated_seq DESC, document_type, document_key
    LIMIT $8
)
SELECT limited.document_type, limited.document_key, limited.title, limited.href,
       limited.updated_seq, limited.published_at, limited.rank,
       ts_headline(
           'english'::regconfig,
           concat_ws(' ', limited.title_text, limited.body),
           search_query.value,
           'MaxWords=24, MinWords=8, StartSel=, StopSel='
       ) AS excerpt_marked
FROM limited
CROSS JOIN search_query
ORDER BY limited.rank DESC, limited.updated_seq DESC,
         limited.document_type, limited.document_key
