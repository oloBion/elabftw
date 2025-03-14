<?php declare(strict_types=1);
/**
 * @author Nicolas CARPi <nico-git@deltablot.email>
 * @copyright 2012 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

namespace Elabftw\Elabftw;

use function array_filter;
use Elabftw\Exceptions\DatabaseErrorException;
use Elabftw\Exceptions\FilesystemErrorException;
use Elabftw\Exceptions\IllegalActionException;
use Elabftw\Exceptions\ImproperActionException;
use Elabftw\Models\ExperimentsCategories;
use Elabftw\Models\ExperimentsStatus;
use Elabftw\Models\ItemsStatus;
use Elabftw\Models\ItemsTypes;
use Elabftw\Models\TeamGroups;
use Elabftw\Models\Teams;
use Elabftw\Models\TeamTags;
use Elabftw\Services\DummyRemoteDirectory;
use Elabftw\Services\EairefRemoteDirectory;
use Elabftw\Services\UsersHelper;
use Exception;

use GuzzleHttp\Client;
use Symfony\Component\HttpFoundation\Response;

/**
 * Administration panel of a team
 */
require_once 'app/init.inc.php';
$App->pageTitle = _('Admin panel');
$Response = new Response();
$Response->prepare($App->Request);

$template = 'error.html';
$renderArr = array();

try {
    if (!$App->Users->isAdmin) {
        throw new IllegalActionException('Non admin user tried to access admin controller.');
    }

    $ItemsTypes = new ItemsTypes($App->Users);
    $Teams = new Teams($App->Users, $App->Users->userData['team']);
    $Status = new ExperimentsStatus($Teams);
    $ItemsStatus = new ItemsStatus($Teams);
    $TeamTags = new TeamTags($App->Users);
    $TeamGroups = new TeamGroups($App->Users);
    $PermissionsHelper = new PermissionsHelper();

    $itemsCategoryArr = $ItemsTypes->readAll();
    $ExperimentsCategories = new ExperimentsCategories($Teams);
    $experimentsCategoriesArr = $ExperimentsCategories->readAll();
    if ($App->Request->query->has('templateid')) {
        $ItemsTypes->setId($App->Request->query->getInt('templateid'));
    }
    $statusArr = $Status->readAll();
    $itemsStatusArr = $ItemsStatus->readAll();
    $teamGroupsArr = $TeamGroups->readAll();
    $teamsArr = $Teams->readAll();
    $allTeamUsersArr = $App->Users->readAllFromTeam();
    // only the unvalidated ones
    $unvalidatedUsersArr = array_filter($allTeamUsersArr, function ($u) {
        return $u['validated'] === 0;
    });
    // Users search
    $isSearching = false;
    $usersArr = array();
    if ($App->Request->query->has('q')) {
        $isSearching = true;
        $usersArr = $App->Users->readFromQuery(
            $App->Request->query->getString('q'),
            $App->Request->query->getBoolean('includeNotTeam') ? 0 : $App->Users->userData['team'],
            $App->Request->query->getBoolean('includeArchived'),
            $App->Request->query->getBoolean('onlyAdmins'),
        );
        foreach ($usersArr as &$user) {
            $UsersHelper = new UsersHelper((int) $user['userid']);
            $user['teams'] = $UsersHelper->getTeamsFromUserid();
        }
    }

    // Remote directory search
    $remoteDirectoryUsersArr = array();
    if ($App->Request->query->has('remote_dir_query')) {
        if ($App->Config->configArr['remote_dir_service'] === 'eairef') {
            $RemoteDirectory = new EairefRemoteDirectory(new Client(), $App->Config->configArr['remote_dir_config']);
        } else {
            $RemoteDirectory = new DummyRemoteDirectory(new Client(), $App->Config->configArr['remote_dir_config']);
        }
        $remoteDirectoryUsersArr = $RemoteDirectory->search($App->Request->query->getString('remote_dir_query'));
        if (empty($remoteDirectoryUsersArr)) {
            $App->warning[] = _('No users found. Try another search.');
        }
    }

    $metadataGroups = array();
    if (isset($ItemsTypes->entityData['metadata'])) {
        $metadataGroups = (new Metadata($ItemsTypes->entityData['metadata']))->getGroups();
    }

    $template = 'admin.html';
    $renderArr = array(
        'Entity' => $ItemsTypes,
        'allTeamUsersArr' => $allTeamUsersArr,
        // all the tags for the team
        'tagsArr' => $TeamTags->readFull(),
        'isSearching' => $isSearching,
        'itemsCategoryArr' => $itemsCategoryArr,
        'metadataGroups' => $metadataGroups,
        'allTeamgroupsArr' => $TeamGroups->readAllGlobal(),
        'statusArr' => $statusArr,
        'experimentsCategoriesArr' => $experimentsCategoriesArr,
        'itemsStatusArr' => $itemsStatusArr,
        'teamGroupsArr' => $teamGroupsArr,
        'visibilityArr' => $PermissionsHelper->getAssociativeArray(),
        'remoteDirectoryUsersArr' => $remoteDirectoryUsersArr,
        'teamsArr' => $teamsArr,
        'unvalidatedUsersArr' => $unvalidatedUsersArr,
        'usersArr' => $usersArr,
    );
} catch (IllegalActionException $e) {
    $App->Log->notice('', array(array('userid' => $App->Session->get('userid')), array('IllegalAction', $e)));
    $renderArr['error'] = Tools::error(true);
} catch (DatabaseErrorException | FilesystemErrorException | ImproperActionException $e) {
    $App->Log->error('', array(array('userid' => $App->Session->get('userid')), array('Error', $e)));
    $renderArr['error'] = $e->getMessage();
} catch (Exception $e) {
    $App->Log->error('', array(array('userid' => $App->Session->get('userid')), array('Exception' => $e)));
    $renderArr['error'] = Tools::error();
} finally {
    $Response->setContent($App->render($template, $renderArr));
    $Response->send();
}
