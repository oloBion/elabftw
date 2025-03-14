<?php declare(strict_types=1);
/**
 * @author Nicolas CARPi <nico-git@deltablot.email>
 * @copyright 2012, 2022 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

namespace Elabftw\Elabftw;

use Elabftw\Enums\EntityType;
use Elabftw\Enums\FilterableColumn;
use Elabftw\Enums\Metadata as MetadataEnum;
use Elabftw\Enums\Orderby;
use Elabftw\Enums\Scope;
use Elabftw\Enums\Sort;
use Elabftw\Models\Users;
use Elabftw\Services\Check;
use Elabftw\Services\Filter;
use function implode;
use function json_encode;
use const JSON_HEX_APOS;
use const JSON_THROW_ON_ERROR;
use PDO;
use function sprintf;
use Symfony\Component\HttpFoundation\Request;
use function trim;

/**
 * This class holds the values for limit, offset, order and sort
 * It is based on user preferences, overridden by request parameters
 */
class DisplayParams
{
    public int $limit = 15;

    public int $offset = 0;

    public string $filterSql = '';

    public Orderby $orderby = Orderby::Date;

    public Sort $sort = Sort::Desc;

    // the search from the top right search bar on experiments/database
    public string $query = '';

    // the extended search query
    public string $extendedQuery = '';

    // if this variable is not empty the error message shown will be different if there are no results
    public string $searchType = '';

    // start metadata stuff
    public bool $hasMetadataSearch = false;

    public array $metadataKey = array();

    public array $metadataValuePath = array();

    public array $metadataValue = array();
    // end metadata stuff

    public bool $includeArchived = false;

    private array $metadataHaving = array();

    public function __construct(private Users $Users, private Request $Request, public EntityType $entityType)
    {
        // load user's preferences first
        $this->limit = $Users->userData['limit_nb'] ?? $this->limit;
        $this->orderby = Orderby::tryFrom($Users->userData['orderby'] ?? $this->orderby->value) ?? $this->orderby;
        $this->sort = Sort::tryFrom($Users->userData['sort'] ?? $this->sort->value) ?? $this->sort;
        $this->adjust();
        // we don't care about the value, so it can be 'on' from a checkbox or 1 or anything really
        $this->includeArchived = $this->Request->query->has('archived');
    }

    public function appendFilterSql(FilterableColumn $column, int $value): void
    {
        $this->filterSql .= sprintf(' AND %s = %d', $column->value, $value);
    }

    public function getMetadataHavingSql(): string
    {
        if (!empty($this->metadataHaving)) {
            return 'HAVING ' . implode(' AND ', $this->metadataHaving);
        }
        return '';
    }

    private function addMetadataFilter(string $extraFieldKey, string $searchTerm): void
    {
        $this->hasMetadataSearch = true;
        $i = count($this->metadataKey);

        $jsonPath = sprintf(
            '$.%s.%s',
            MetadataEnum::ExtraFields->value,
            // Note: the extraFieldKey gets double quoted so spaces are not an issue
            json_encode($extraFieldKey, JSON_HEX_APOS | JSON_THROW_ON_ERROR)
        );
        $this->metadataKey[] = $jsonPath;
        $this->metadataValuePath[] = $jsonPath . '.value';
        $this->metadataValue[] = $searchTerm;
        $this->metadataHaving[] = sprintf('(JSON_UNQUOTE(JSON_EXTRACT(LOWER(entity.metadata), LOWER(:metadata_value_path_%1$d))) LIKE LOWER(:metadata_value_%1$d))', $i);
    }

    /**
     * Adjust the settings based on the Request
     */
    private function adjust(): void
    {
        if ($this->Request->query->has('limit')) {
            $this->limit = Check::limit($this->Request->query->getInt('limit'));
        }
        if ($this->Request->query->has('offset') && Check::id($this->Request->query->getInt('offset')) !== false) {
            $this->offset = $this->Request->query->getInt('offset');
        }
        if (!empty($this->Request->query->get('q'))) {
            $this->query = trim($this->Request->query->getString('q'));
            $this->searchType = 'query';
        }
        if (!empty($this->Request->query->get('extended'))) {
            $this->extendedQuery = trim($this->Request->query->getString('extended'));
            $this->searchType = 'extended';
        }
        // filter by user if we don't want to show the rest of the team, only for experiments
        // looking for an owner will bypass the user preference
        // same with an extended search: we show all
        if ($this->Users->userData['scope_' . $this->entityType->value] === Scope::User->value && empty($this->Request->query->get('owner')) && empty($this->Request->query->get('extended'))) {
            // Note: the cast to int is necessary here (not sure why)
            $this->appendFilterSql(FilterableColumn::Owner, (int) $this->Users->userData['userid']);
        }
        // TAGS SEARCH
        if (!empty(($this->Request->query->all('tags'))[0])) {
            // get all the ids with that tag
            $tags = $this->Request->query->all('tags');
            // look for item ids that have all the tags not only one of them
            // the HAVING COUNT is necessary to make an AND search between tags
            // Note: we cannot use a placeholder for the IN of the tags because we need the quotes
            $Db = Db::getConnection();
            $inPlaceholders = implode(' , ', array_map(function ($key) {
                return ":tag$key";
            }, array_keys($tags)));
            $sql = 'SELECT tags2entity.item_id FROM `tags2entity`
                INNER JOIN (SELECT id FROM tags WHERE tags.tag IN ( ' . $inPlaceholders . ' )) tg ON tags2entity.tag_id = tg.id
                WHERE tags2entity.item_type = :type GROUP BY item_id HAVING COUNT(DISTINCT tags2entity.tag_id) = :count';
            $req = $Db->prepare($sql);
            // bind the tags in IN clause
            foreach ($tags as $key => $tag) {
                $req->bindValue(":tag$key", $tag, PDO::PARAM_STR);
            }
            $req->bindValue(':type', $this->entityType->value, PDO::PARAM_STR);
            $req->bindValue(':count', count($tags), PDO::PARAM_INT);
            $req->execute();
            $this->filterSql = Tools::getIdFilterSql($req->fetchAll(PDO::FETCH_COLUMN));
            $this->searchType = 'tags';
        }
        // now get ordering/sorting parameters from the query string
        $this->sort = Sort::tryFrom($this->Request->query->getAlpha('sort')) ?? $this->sort;
        $this->orderby = Orderby::tryFrom($this->Request->query->getAlpha('order')) ?? $this->orderby;

        // RELATED FILTER
        if (Check::id($this->Request->query->getInt('related')) !== false) {
            $this->appendFilterSql(FilterableColumn::Related, $this->Request->query->getInt('related'));
            $this->searchType = 'related';
        }
        // CATEGORY FILTER
        if (Check::id($this->Request->query->getInt('cat')) !== false) {
            $this->appendFilterSql(FilterableColumn::Category, $this->Request->query->getInt('cat'));
            $this->searchType = 'category';
        }
        // STATUS FILTER
        if (Check::id($this->Request->query->getInt('status')) !== false) {
            $this->appendFilterSql(FilterableColumn::Status, $this->Request->query->getInt('status'));
            $this->searchType = 'status';
        }

        // OWNER (USERID) FILTER
        if (Check::id($this->Request->query->getInt('owner')) !== false) {
            $this->appendFilterSql(FilterableColumn::Owner, $this->Request->query->getInt('owner'));
            $this->searchType = 'owner';
        }
        // METADATA SEARCH
        foreach ($this->Request->query->all('metakey') as $i => $metakey) {
            if (!empty($metakey)) {
                $this->addMetadataFilter($metakey, $this->Request->query->all('metavalue')[$i]);
            }
        }
    }
}
