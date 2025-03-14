<?php declare(strict_types=1);
/**
 * @author Nicolas CARPi <nico-git@deltablot.email>
 * @copyright 2022 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

namespace Elabftw\Enums;

enum FilterableColumn: string
{
    case Bookable = 'entity.is_bookable';
    case Canread = 'entity.canread';
    case Category = 'categoryt.id';
    case Owner = 'entity.userid';
    case Related = 'linkst.link_id';
    case Status = 'statust.id';
}
